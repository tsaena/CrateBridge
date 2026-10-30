import type {
  CatalogRecording,
  Confidence,
  ExplicitPreference,
  MatchReason,
  RankedCandidate,
  VersionTag,
} from '../../types';
import {
  SOFT_VERSION_TAGS,
  VERSION_LABELS,
  analyzeTitle,
  formatDuration,
  normalizeText,
  primaryArtist,
  splitArtists,
  tokens,
} from '../normalize';

export interface MatchRequest {
  artist: string;
  title: string;
  album?: string;
  durationMs?: number;
  isrc?: string;
}

/**
 * Point values for each rule. Kept in one place so the algorithm stays
 * explainable: every point added or removed produces a visible reason.
 */
export const WEIGHTS = {
  titleExact: 40,
  titleSimilar: 25,
  titlePartial: 10,
  titleDifferent: -30,
  artistExact: 35,
  artistCredited: 30,
  artistPartial: 15,
  artistDifferent: -25,
  featuredPresent: 3,
  versionMatch: 10,
  versionMissing: -20,
  unrequestedMajor: -30,
  unrequestedSubstitute: -45,
  unrequestedEdit: -12,
  remixerMatch: 8,
  remixerDifferent: -10,
  explicitPreferred: 6,
  explicitConflict: -10,
  cleanWhenAny: -4,
  durationClose: 10,
  durationNear: 5,
  durationFar: -12,
  albumExact: 8,
  albumPartial: 4,
  isrcMatch: 50,
  isrcMismatch: -20,
  purchasable: 4,
  notPurchasable: -6,
} as const;

/** Versions that replace the performance entirely (not the artist's recording). */
const SUBSTITUTE_TAGS: ReadonlySet<VersionTag> = new Set(['karaoke', 'cover', 'instrumental']);
/** Edits of the same performance; a smaller penalty when unrequested. */
const EDIT_TAGS: ReadonlySet<VersionTag> = new Set(['extended', 'radio_edit']);

const LIVE_ALBUM = /\blive (?:at|in|from|on)\b|\blive$|^live\b|\bunplugged\b|\bin concert\b/;
const SUBSTITUTE_CONTEXT = /\bkaraoke\b|\btribute\b|\bin the style of\b|\bmade famous by\b|\boriginally performed\b|\bcover (?:version|band)s?\b|\bsound ?alike\b/;

export function rankCandidates(
  request: MatchRequest,
  recordings: CatalogRecording[],
  preference: ExplicitPreference = 'any',
): RankedCandidate[] {
  const seen = new Set<string>();
  const unique = recordings.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  return unique
    .map((recording) => scoreCandidate(request, recording, preference))
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(isPurchasable(b.recording)) - Number(isPurchasable(a.recording)) ||
        (a.recording.releaseDate ?? '9999').localeCompare(b.recording.releaseDate ?? '9999'),
    );
}

export function isPurchasable(recording: CatalogRecording): boolean {
  return recording.price !== undefined && recording.price > 0 && Boolean(recording.listingUrl);
}

export function scoreCandidate(
  request: MatchRequest,
  recording: CatalogRecording,
  preference: ExplicitPreference = 'any',
): RankedCandidate {
  const reasons: MatchReason[] = [];
  let score = 0;
  const add = (points: number, text: string, effect?: MatchReason['effect']) => {
    score += points;
    reasons.push({ effect: effect ?? (points > 0 ? 'plus' : points < 0 ? 'minus' : 'neutral'), text });
  };

  const want = analyzeTitle(request.title);
  const got = analyzeTitle(recording.title);

  // Title
  let titleOk = false;
  let titleExact = false;
  if (want.core && want.core === got.core) {
    titleExact = titleOk = true;
    add(WEIGHTS.titleExact, 'Title matches');
  } else {
    const similarity = tokenSimilarity(want.core, got.core);
    if (similarity >= 0.75) {
      titleOk = true;
      add(WEIGHTS.titleSimilar, 'Title is very similar');
    } else if (similarity >= 0.5) {
      titleOk = true;
      add(WEIGHTS.titlePartial, 'Title partly matches');
    } else {
      add(WEIGHTS.titleDifferent, 'Title differs');
    }
  }

  // Artist
  const wantArtists = artistList(request.artist);
  const wantPrimary = wantArtists[0] ?? '';
  const gotArtists = artistList(recording.artist);
  const gotPrimary = gotArtists[0] ?? '';
  let artistOk = false;
  if (!wantPrimary) {
    add(0, 'No artist to compare');
  } else if (wantPrimary === gotPrimary || normalizeText(primaryArtist(request.artist)) === normalizeText(primaryArtist(recording.artist))) {
    artistOk = true;
    add(WEIGHTS.artistExact, 'Artist matches');
  } else if (gotArtists.includes(wantPrimary)) {
    artistOk = true;
    add(WEIGHTS.artistCredited, `${recording.artist} credits the requested artist`);
  } else if (tokenSimilarity(wantPrimary, gotPrimary) >= 0.5) {
    add(WEIGHTS.artistPartial, 'Artist name partly matches');
  } else {
    add(WEIGHTS.artistDifferent, `Different artist (${recording.artist})`);
  }

  // Featured artists: a small bonus only, because stores credit features inconsistently.
  const wantFeatured = [...wantArtists.slice(1), ...want.featured.map(normalizeText)];
  const gotCredits = new Set([...gotArtists, ...got.featured.map(normalizeText)]);
  const featuredFound = wantFeatured.filter((name) => gotCredits.has(name) || normalizeText(recording.title).includes(name));
  if (featuredFound.length > 0) {
    add(Math.min(featuredFound.length, 2) * WEIGHTS.featuredPresent, 'Featured artists credited');
  }

  // Versions
  const versionConflict = scoreVersions(recording, want.tags, gotVersionTags(recording, got.tags), want.qualifierTokens, got.qualifierTokens, add);

  // Clean / explicit
  const effectivePreference: ExplicitPreference = want.tags.includes('clean')
    ? 'clean'
    : want.tags.includes('explicit')
      ? 'explicit'
      : preference;
  if (effectivePreference === 'clean') {
    if (recording.explicitness === 'clean') add(WEIGHTS.explicitPreferred, 'Clean version (preferred)');
    else if (recording.explicitness === 'explicit') add(WEIGHTS.explicitConflict, 'Explicit version (clean preferred)');
  } else if (effectivePreference === 'explicit') {
    if (recording.explicitness === 'explicit') add(WEIGHTS.explicitPreferred, 'Explicit version (preferred)');
    else if (recording.explicitness === 'clean') add(WEIGHTS.explicitConflict, 'Clean edit (explicit preferred)');
  } else if (recording.explicitness === 'clean') {
    add(WEIGHTS.cleanWhenAny, 'Clean (edited) version');
  }

  // Duration
  let durationFar = false;
  if (request.durationMs && recording.durationMs) {
    const diff = Math.abs(request.durationMs - recording.durationMs) / 1000;
    if (diff <= 3) add(WEIGHTS.durationClose, `Duration matches (${formatDuration(recording.durationMs)})`);
    else if (diff <= 10) add(WEIGHTS.durationNear, `Duration within ${Math.round(diff)}s`);
    else if (diff <= 30) add(0, `Duration differs by ${Math.round(diff)}s`);
    else {
      durationFar = true;
      add(WEIGHTS.durationFar, `Duration differs by ${formatDuration(diff * 1000)}`);
    }
  }

  // Album
  if (request.album && recording.album) {
    const wantAlbum = normalizeText(request.album);
    const gotAlbum = normalizeText(recording.album);
    if (wantAlbum === gotAlbum) add(WEIGHTS.albumExact, 'Album matches');
    else if (wantAlbum && gotAlbum && (gotAlbum.includes(wantAlbum) || wantAlbum.includes(gotAlbum))) {
      add(WEIGHTS.albumPartial, 'Album is similar');
    }
  }

  // ISRC identifies a specific recording, so it outweighs everything else.
  let isrcMatch = false;
  if (request.isrc && recording.isrc) {
    if (request.isrc.toUpperCase() === recording.isrc.toUpperCase()) {
      isrcMatch = true;
      add(WEIGHTS.isrcMatch, 'ISRC matches (same recording)');
    } else add(WEIGHTS.isrcMismatch, 'ISRC differs');
  }

  if (isPurchasable(recording)) add(WEIGHTS.purchasable, 'Sold as an individual track');
  else add(WEIGHTS.notPurchasable, 'No individual track price (may be album-only or unavailable)');

  let confidence: Confidence;
  if (isrcMatch || (titleExact && artistOk && !versionConflict && !durationFar)) confidence = 'high';
  else if (titleOk && (artistOk || !wantPrimary || score >= 40)) confidence = 'review';
  else confidence = 'none';

  return { recording, score, confidence, reasons };
}

function scoreVersions(
  recording: CatalogRecording,
  wantTags: VersionTag[],
  gotTags: VersionTag[],
  wantQualifiers: string[],
  gotQualifiers: string[],
  add: (points: number, text: string, effect?: MatchReason['effect']) => void,
): boolean {
  const wantHard = wantTags.filter((t) => !SOFT_VERSION_TAGS.has(t));
  const gotHard = gotTags.filter((t) => !SOFT_VERSION_TAGS.has(t));
  let conflict = false;

  for (const tag of gotHard) {
    if (wantHard.includes(tag)) continue;
    // A requested remix may be an extended or radio edit of that remix.
    if (EDIT_TAGS.has(tag) && wantHard.includes('remix')) continue;
    conflict = true;
    if (SUBSTITUTE_TAGS.has(tag)) add(WEIGHTS.unrequestedSubstitute, `${VERSION_LABELS[tag]} version (not the requested recording)`);
    else if (EDIT_TAGS.has(tag)) add(WEIGHTS.unrequestedEdit, `${VERSION_LABELS[tag]} (not requested)`);
    else add(WEIGHTS.unrequestedMajor, `${VERSION_LABELS[tag]} version (not requested)`);
  }

  for (const tag of wantHard) {
    if (gotHard.includes(tag)) continue;
    conflict = true;
    add(WEIGHTS.versionMissing, `Requested ${VERSION_LABELS[tag]} version not indicated`);
  }

  if (wantHard.length > 0 && wantHard.every((t) => gotHard.includes(t))) {
    add(WEIGHTS.versionMatch, `Version matches (${wantHard.map((t) => VERSION_LABELS[t]).join(', ')})`);
  }

  if (wantHard.includes('remix') && gotHard.includes('remix') && wantQualifiers.length > 0) {
    const overlap = wantQualifiers.some((t) => gotQualifiers.includes(t));
    if (overlap) add(WEIGHTS.remixerMatch, 'Remixer matches');
    else if (gotQualifiers.length > 0) {
      conflict = true;
      add(WEIGHTS.remixerDifferent, 'Different remix');
    }
  }

  if (gotTags.includes('remaster') && !wantTags.includes('remaster')) add(0, 'Remastered release');
  if (recording.album && /\b(?:greatest hits|best of|hits)\b/i.test(recording.album)) add(0, 'From a compilation');

  return conflict;
}

/** Version tags for a catalog result, including hints from its album and artist credit. */
function gotVersionTags(recording: CatalogRecording, titleTags: VersionTag[]): VersionTag[] {
  const tags = new Set(titleTags);
  const album = normalizeText(recording.album ?? '');
  const artist = normalizeText(recording.artist);
  if (LIVE_ALBUM.test(album)) tags.add('live');
  if (SUBSTITUTE_CONTEXT.test(album) || SUBSTITUTE_CONTEXT.test(artist)) {
    tags.add(/karaoke|in the style of|made famous|sound ?alike/.test(album + ' ' + artist) ? 'karaoke' : 'cover');
  }
  if (recording.explicitness === 'clean') tags.add('clean');
  return [...tags];
}

function artistList(credit: string): string[] {
  return splitArtists(credit).map(normalizeText).filter(Boolean);
}

/** Dice coefficient over word tokens; 1 when one title fully contains the other's words. */
export function tokenSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const setB = new Set(tb);
  const shared = ta.filter((t) => setB.has(t)).length;
  return (2 * shared) / (ta.length + tb.length);
}

/** Overall classification for a track from its ranked candidates. */
export function bestConfidence(candidates: RankedCandidate[]): Confidence {
  return candidates[0]?.confidence ?? 'none';
}
