import type {
  CatalogRecording,
  Confidence,
  MatchReason,
  MatchState,
  PurchaseStatus,
  RankedCandidate,
  Track,
  TrackSource,
  Workspace,
  WorkspaceSettings,
} from '../types';
import { PURCHASE_STATUSES } from '../types';
import { DEFAULT_SETTINGS, emptyWorkspace } from './workspace';
import { itunesStoreUrl, safeAppleUrl } from '../lib/providers/itunes';

export const STORAGE_KEY = 'cratebridge:workspace';
export const BACKUP_KEY = 'cratebridge:workspace:backup';
export const SCHEMA_VERSION = 1;

interface StoredWorkspace {
  version: number;
  savedAt: number;
  workspace: Workspace;
}

export type LoadOutcome =
  | { kind: 'empty'; workspace: Workspace }
  | { kind: 'restored'; workspace: Workspace; droppedTracks: number }
  | { kind: 'recovered'; workspace: Workspace; message: string };

/** Minimal Storage surface so tests can pass an in-memory implementation. */
export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function defaultStorage(): StorageLike | undefined {
  try {
    return typeof window !== 'undefined' ? window.localStorage : undefined;
  } catch {
    // Accessing localStorage throws when storage is disabled.
    return undefined;
  }
}

export function loadWorkspace(storage: StorageLike | undefined = defaultStorage()): LoadOutcome {
  if (!storage) return { kind: 'empty', workspace: emptyWorkspace() };
  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return { kind: 'empty', workspace: emptyWorkspace() };
  }
  if (!raw) return { kind: 'empty', workspace: emptyWorkspace() };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    backup(storage, raw);
    return {
      kind: 'recovered',
      workspace: emptyWorkspace(),
      message: 'Your saved workspace could not be read, so a fresh one was started. The unreadable data was kept as a backup in this browser.',
    };
  }

  if (!isRecord(parsed) || typeof parsed.version !== 'number' || !isRecord(parsed.workspace)) {
    backup(storage, raw);
    return {
      kind: 'recovered',
      workspace: emptyWorkspace(),
      message: 'Your saved workspace was in an unexpected format, so a fresh one was started. The old data was kept as a backup.',
    };
  }

  if (parsed.version > SCHEMA_VERSION) {
    backup(storage, raw);
    return {
      kind: 'recovered',
      workspace: emptyWorkspace(),
      message: 'Your workspace was saved by a newer version of CrateBridge. It was kept as a backup and a fresh workspace was started.',
    };
  }

  const { workspace, dropped } = sanitizeWorkspace(parsed.workspace);
  return { kind: 'restored', workspace, droppedTracks: dropped };
}

export type SaveResult = { ok: true } | { ok: false; message: string };

export function saveWorkspace(workspace: Workspace, storage: StorageLike | undefined = defaultStorage()): SaveResult {
  if (!storage) return { ok: false, message: 'Browser storage is unavailable, so progress won’t be saved.' };
  const payload: StoredWorkspace = { version: SCHEMA_VERSION, savedAt: Date.now(), workspace: compact(workspace) };
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return { ok: true };
  } catch {
    return { ok: false, message: 'Browser storage is full or blocked, so recent changes weren’t saved.' };
  }
}

export function clearStoredWorkspace(storage: StorageLike | undefined = defaultStorage()): void {
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
    // Nothing else to do; the in-memory workspace is already cleared.
  }
}

function backup(storage: StorageLike, raw: string): void {
  try {
    storage.setItem(BACKUP_KEY, raw);
  } catch {
    // Backup is best effort.
  }
}

/** Drop transient state before saving: in-flight searches are re-queued on load. */
function compact(workspace: Workspace): Workspace {
  return {
    settings: workspace.settings,
    tracks: workspace.tracks.map((t) =>
      t.match.phase === 'searching' ? { ...t, match: { ...t.match, phase: 'queued' } } : t,
    ),
  };
}

// ---------------------------------------------------------------------------
// Validation. Stored data may be hand-edited, truncated, or from an older build,
// so every field is checked and anything unusable is dropped or defaulted.

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const SOURCES: TrackSource[] = ['paste', 'csv', 'manual', 'sample'];
const CONFIDENCES: Confidence[] = ['high', 'review', 'none'];

export function sanitizeWorkspace(value: Record<string, unknown>): { workspace: Workspace; dropped: number } {
  const settings = sanitizeSettings(value.settings);
  const rawTracks = Array.isArray(value.tracks) ? value.tracks : [];
  const tracks: Track[] = [];
  const ids = new Set<string>();
  for (const raw of rawTracks) {
    const track = sanitizeTrack(raw);
    if (track && !ids.has(track.id)) {
      ids.add(track.id);
      tracks.push(track);
    }
  }
  return { workspace: { settings, tracks }, dropped: rawTracks.length - tracks.length };
}

function sanitizeSettings(value: unknown): WorkspaceSettings {
  if (!isRecord(value)) return { ...DEFAULT_SETTINGS };
  const country = str(value.country);
  const pref = value.explicitPreference;
  return {
    country: country && /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : DEFAULT_SETTINGS.country,
    explicitPreference: pref === 'clean' || pref === 'explicit' || pref === 'any' ? pref : DEFAULT_SETTINGS.explicitPreference,
    searchModifiers: Array.isArray(value.searchModifiers)
      ? value.searchModifiers.filter((m): m is string => typeof m === 'string').slice(0, 10)
      : [],
    autoMatch: typeof value.autoMatch === 'boolean' ? value.autoMatch : DEFAULT_SETTINGS.autoMatch,
  };
}

function sanitizeTrack(value: unknown): Track | undefined {
  if (!isRecord(value)) return undefined;
  const id = str(value.id);
  const artist = str(value.artist) ?? '';
  const title = str(value.title) ?? '';
  if (!id || (!artist && !title)) return undefined;
  const status = PURCHASE_STATUSES.includes(value.status as PurchaseStatus) ? (value.status as PurchaseStatus) : 'not_started';
  const source = SOURCES.includes(value.source as TrackSource) ? (value.source as TrackSource) : 'manual';
  return {
    id,
    artist,
    title,
    album: str(value.album),
    durationMs: num(value.durationMs),
    isrc: str(value.isrc),
    source,
    status,
    addedAt: num(value.addedAt) ?? 0,
    parseWarning: str(value.parseWarning),
    searchOverride: str(value.searchOverride),
    match: sanitizeMatch(value.match),
  };
}

function sanitizeMatch(value: unknown): MatchState {
  if (!isRecord(value)) return { phase: 'queued', candidates: [] };
  const candidates = Array.isArray(value.candidates)
    ? value.candidates.map(sanitizeCandidate).filter((c): c is RankedCandidate => Boolean(c))
    : [];
  const phase = value.phase;
  const done = phase === 'done';
  const error = phase === 'error';
  const selectedId = str(value.selectedId);
  return {
    // Anything that wasn't finished is looked up again.
    phase: done ? 'done' : error ? 'error' : 'queued',
    signature: done || error ? str(value.signature) : undefined,
    candidates: done ? candidates : [],
    selectedId: selectedId && candidates.some((c) => c.recording.id === selectedId) ? selectedId : candidates[0]?.recording.id,
    userSelected: value.userSelected === true ? true : undefined,
    error: error ? str(value.error) : undefined,
    searchedAt: num(value.searchedAt),
  };
}

function sanitizeCandidate(value: unknown): RankedCandidate | undefined {
  if (!isRecord(value) || !isRecord(value.recording)) return undefined;
  const r = value.recording;
  const id = str(r.id);
  const title = str(r.title);
  const artist = str(r.artist);
  if (!id || !title || !artist) return undefined;
  const explicitness = r.explicitness;
  const recording: CatalogRecording = {
    id,
    provider: 'itunes',
    title,
    artist,
    album: str(r.album),
    artworkUrl: safeAppleUrl(httpsOnly(str(r.artworkUrl))),
    durationMs: num(r.durationMs),
    explicitness:
      explicitness === 'explicit' || explicitness === 'clean' || explicitness === 'not_explicit' ? explicitness : 'unknown',
    price: num(r.price),
    currency: str(r.currency),
    // Also upgrades links saved before they carried the iTunes Store parameter.
    listingUrl: itunesStoreUrl(httpsOnly(str(r.listingUrl))),
    releaseDate: str(r.releaseDate),
    genre: str(r.genre),
    isrc: str(r.isrc),
  };
  const reasons: MatchReason[] = Array.isArray(value.reasons)
    ? value.reasons.filter(
        (x): x is MatchReason =>
          isRecord(x) && typeof x.text === 'string' && (x.effect === 'plus' || x.effect === 'minus' || x.effect === 'neutral'),
      )
    : [];
  return {
    recording,
    score: num(value.score) ?? 0,
    confidence: CONFIDENCES.includes(value.confidence as Confidence) ? (value.confidence as Confidence) : 'review',
    reasons,
  };
}

function httpsOnly(url: string | undefined): string | undefined {
  return url && url.startsWith('https://') ? url : undefined;
}
