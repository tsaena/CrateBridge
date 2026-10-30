import type { VersionTag } from '../types';

/**
 * Lowercase, strip diacritics and punctuation, and collapse whitespace so that
 * "Beyoncé – Halo!" and "beyonce halo" compare equal.
 */
export function normalizeText(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/&/g, ' and ')
    .replace(/\$/g, 's')
    .replace(/'/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function tokens(input: string): string[] {
  const normalized = normalizeText(input);
  return normalized ? normalized.split(' ') : [];
}

// "feat." credits may be bracketed or bare; "with" only counts inside brackets,
// because titles like "Dancing with Myself" use it as an ordinary word.
const FEATURE_PATTERN = /\s*(?:[([]\s*(?:feat\.?|ft\.?|featuring|with)\s+([^)\]]+)[)\]]|\b(?:feat\.?|ft\.?|featuring)\s+([^()[\]]+))/i;
const ARTIST_FEATURE_SPLIT = /\s+(?:feat\.?|ft\.?|featuring)\s+/i;

/** Split an artist credit like "Usher feat. Lil Jon & Ludacris" into names. */
export function splitArtists(credit: string): string[] {
  return credit
    .split(/\s*(?:,|&|\+|\/|;|\bx\b|\band\b|\bvs\.?\b|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b)\s*/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** The first credited artist, ignoring any featured artists. */
export function primaryArtist(credit: string): string {
  const [main] = credit.split(ARTIST_FEATURE_SPLIT);
  return (main ?? credit).trim();
}

/** Featured artists named inside a title, e.g. "Uptown Funk (feat. Bruno Mars)". */
export function featuredInTitle(title: string): string[] {
  const match = FEATURE_PATTERN.exec(title);
  const names = match?.[1] ?? match?.[2];
  return names ? splitArtists(names) : [];
}

/** Remove a featured-artist credit from a title. */
export function stripFeatured(title: string): string {
  return title.replace(FEATURE_PATTERN, ' ').replace(/\s+/g, ' ').trim() || title;
}

interface VersionRule {
  tag: VersionTag;
  pattern: RegExp;
}

// Order matters only for readability; every rule is checked.
const VERSION_RULES: VersionRule[] = [
  { tag: 'radio_edit', pattern: /\bradio (?:edit|version|mix)\b|\bsingle (?:edit|version)\b/ },
  { tag: 'extended', pattern: /\bextended\b|\bclub mix\b|\b12 (?:inch )?(?:mix|version)\b/ },
  { tag: 'remix', pattern: /\bremix(?:ed)?\b|\brmx\b|\brework\b|\bbootleg\b|\bvip mix\b|\bdub mix\b|\bflip\b/ },
  { tag: 'live', pattern: /\blive\b(?! (?:forever|wire|your life|it up|and let die))|\bin concert\b|\bunplugged\b/ },
  { tag: 'acoustic', pattern: /\bacoustic\b/ },
  { tag: 'instrumental', pattern: /\binstrumental\b/ },
  { tag: 'karaoke', pattern: /\bkaraoke\b|\bin the style of\b|\boriginally performed by\b|\bmade famous by\b/ },
  { tag: 'cover', pattern: /\bcover\b|\btribute\b/ },
  { tag: 'remaster', pattern: /\bremaster(?:ed)?\b/ },
  { tag: 'demo', pattern: /\bdemo\b/ },
  { tag: 'clean', pattern: /\bclean\b|\bedited\b|\bcensored\b/ },
  { tag: 'explicit', pattern: /\bexplicit\b|\bdirty\b|\buncensored\b/ },
  { tag: 'original', pattern: /\boriginal (?:mix|version|recording)\b/ },
  { tag: 'sped_up', pattern: /\bsped up\b|\bspeed up\b|\bnightcore\b/ },
  { tag: 'slowed', pattern: /\bslowed\b/ },
];

export const VERSION_LABELS: Record<VersionTag, string> = {
  remix: 'Remix',
  live: 'Live',
  acoustic: 'Acoustic',
  instrumental: 'Instrumental',
  karaoke: 'Karaoke',
  cover: 'Cover / Tribute',
  extended: 'Extended',
  radio_edit: 'Radio Edit',
  remaster: 'Remaster',
  demo: 'Demo',
  clean: 'Clean',
  explicit: 'Explicit',
  original: 'Original Mix',
  sped_up: 'Sped Up',
  slowed: 'Slowed',
};

/** Tags that do not change the underlying recording enough to count as a different version. */
export const SOFT_VERSION_TAGS: ReadonlySet<VersionTag> = new Set(['remaster', 'clean', 'explicit', 'original']);

/** Matches a trailing bracketed or dash-separated qualifier. */
const QUALIFIER_PATTERN = /\s*(?:\(([^()]*)\)|\[([^[\]]*)\]|\s[-–—]\s+([^-–—]+))\s*$/;

/**
 * Split a title into its core and any trailing qualifiers:
 * "Summer - Extended Mix" → core "Summer", qualifiers ["Extended Mix"].
 * Only strips dash qualifiers that look like version descriptors, so titles
 * like "Sweet Child - O' Mine" stay intact.
 */
export function splitTitle(title: string): { core: string; qualifiers: string[] } {
  let core = title.trim();
  const qualifiers: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    const match = QUALIFIER_PATTERN.exec(core);
    if (!match) break;
    const text = (match[1] ?? match[2] ?? match[3] ?? '').trim();
    const isDash = match[3] !== undefined;
    if (isDash && !looksLikeQualifier(text)) break;
    const next = core.slice(0, match.index).trim();
    if (!next) break;
    qualifiers.unshift(text);
    core = next;
  }
  return { core, qualifiers };
}

function looksLikeQualifier(text: string): boolean {
  const lower = normalizeText(text);
  if (detectVersionTags(lower).length > 0) return true;
  return /\b(?:mix|edit|version|feat|ft|featuring|mono|stereo|\d{4})\b/.test(lower);
}

export function detectVersionTags(text: string): VersionTag[] {
  const lower = normalizeText(text);
  const found = new Set<VersionTag>();
  for (const rule of VERSION_RULES) {
    if (rule.pattern.test(lower)) found.add(rule.tag);
  }
  // "Extended Remix" should not also read as a plain remix-less extended edit, and
  // "Radio Edit" of a remix is still a remix; both tags are kept intentionally.
  return [...found];
}

export interface TitleAnalysis {
  /** Normalized core title without featured artists or version qualifiers. */
  core: string;
  /** Core title as typed, for display and search. */
  displayCore: string;
  tags: VersionTag[];
  featured: string[];
  /** Normalized words from qualifiers, e.g. remixer names. */
  qualifierTokens: string[];
}

export function analyzeTitle(title: string): TitleAnalysis {
  const featured = featuredInTitle(title);
  const withoutFeat = stripFeatured(title);
  const { core, qualifiers } = splitTitle(withoutFeat);
  const tags = new Set<VersionTag>(detectVersionTags(qualifiers.join(' ')));
  // Some tags appear in the core title itself without brackets ("Yeah! Live").
  for (const tag of detectVersionTags(core)) {
    if (tag === 'remix' || tag === 'karaoke' || tag === 'instrumental') tags.add(tag);
  }
  return {
    core: normalizeText(core),
    displayCore: core,
    tags: [...tags],
    featured,
    // Years ("2011 Remaster") describe the release, not which recording it is.
    qualifierTokens: tokens(qualifiers.join(' ')).filter((t) => !GENERIC_QUALIFIER_WORDS.has(t) && !/^(?:19|20)\d{2}$/.test(t)),
  };
}

const GENERIC_QUALIFIER_WORDS = new Set([
  'remix', 'mix', 'edit', 'version', 'radio', 'extended', 'original', 'live', 'remastered',
  'remaster', 'feat', 'ft', 'featuring', 'with', 'the', 'a', 'and', 'clean', 'explicit',
]);

export function formatDuration(ms: number | undefined): string {
  if (!ms || ms <= 0) return '—';
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** Parse "3:21", "1:02:03", or a millisecond count into milliseconds. */
export function parseDuration(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    // Bare numbers above an hour in seconds are assumed to be milliseconds.
    if (n > 3600) return n;
    return n > 0 ? n * 1000 : undefined;
  }
  const parts = trimmed.split(':').map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => Number.isNaN(p))) return undefined;
  const seconds = parts.reduce((acc, part) => acc * 60 + part, 0);
  return seconds > 0 ? seconds * 1000 : undefined;
}
