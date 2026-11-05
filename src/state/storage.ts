import type {
  CatalogRecording,
  ExplicitPreference,
  MatchState,
  Playlist,
  PurchaseStatus,
  Track,
  TrackSource,
  Workspace,
  WorkspaceSettings,
} from '../types';
import { PURCHASE_STATUSES } from '../types';
import {
  DEFAULT_PLAYLIST_NAME,
  DEFAULT_SETTINGS,
  MAX_PLAYLIST_NAME_LENGTH,
  createId,
  emptyWorkspace,
  newPlaylist,
} from './workspace';
import { itunesStoreUrl, safeAppleUrl } from '../lib/providers/itunes';
import { rankCandidates, type MatchRequest } from '../lib/matching/rank';
import { MAX_STORED_CANDIDATES } from '../lib/matching/matchTrack';
import { safeSpotifyTrackUrl } from '../lib/spotify/import';

export const STORAGE_KEY = 'cratebridge:workspace';
export const BACKUP_KEY = 'cratebridge:workspace:backup';
/**
 * 1: a single list of tracks.
 * 2: named playlists; match ratings are recomputed on load instead of stored.
 */
export const SCHEMA_VERSION = 2;

interface StoredWorkspace {
  version: number;
  savedAt: number;
  workspace: unknown;
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
    return {
      ok: false,
      message: 'Browser storage is full or blocked, so recent changes weren’t saved. Deleting playlists you no longer need frees up space.',
    };
  }
}

function backup(storage: StorageLike, raw: string): void {
  try {
    storage.setItem(BACKUP_KEY, raw);
  } catch {
    // Backup is best effort.
  }
}

/**
 * Shape the workspace for storage: in-flight searches are saved as queued, and
 * candidates keep only their recordings, since ratings are recomputed on load.
 */
function compact(workspace: Workspace): unknown {
  return {
    settings: workspace.settings,
    activePlaylistId: workspace.activePlaylistId,
    playlists: workspace.playlists.map((p) => ({
      ...p,
      tracks: p.tracks.map((t) => ({
        ...t,
        match: {
          ...t.match,
          phase: t.match.phase === 'searching' ? 'queued' : t.match.phase,
          candidates: t.match.candidates.map((c) => ({ recording: c.recording })),
        },
      })),
    })),
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

const SOURCES: TrackSource[] = ['paste', 'csv', 'manual', 'sample', 'spotify'];

export function sanitizeWorkspace(value: Record<string, unknown>): { workspace: Workspace; dropped: number } {
  const settings = sanitizeSettings(value.settings);
  const trackIds = new Set<string>();
  let seen = 0;
  let kept = 0;
  const readTracks = (raw: unknown): Track[] => {
    const list = Array.isArray(raw) ? raw : [];
    seen += list.length;
    const tracks: Track[] = [];
    for (const item of list) {
      const track = sanitizeTrack(item, settings.explicitPreference);
      // Track ids must be unique across every playlist.
      if (track && !trackIds.has(track.id)) {
        trackIds.add(track.id);
        tracks.push(track);
      }
    }
    kept += tracks.length;
    return tracks;
  };

  let playlists: Playlist[];
  if (Array.isArray(value.playlists)) {
    const playlistIds = new Set<string>();
    playlists = value.playlists.filter(isRecord).map((raw, index) => {
      const storedId = str(raw.id);
      const id = storedId && !playlistIds.has(storedId) ? storedId : createId('p');
      playlistIds.add(id);
      const name = str(raw.name)?.trim().slice(0, MAX_PLAYLIST_NAME_LENGTH) || `Playlist ${index + 1}`;
      return { id, name, createdAt: num(raw.createdAt) ?? 0, tracks: readTracks(raw.tracks) };
    });
  } else {
    // Version 1 stored one list of tracks; it becomes the first playlist.
    playlists = [{ ...newPlaylist(DEFAULT_PLAYLIST_NAME, 0), tracks: readTracks(value.tracks) }];
  }
  if (playlists.length === 0) playlists = [newPlaylist(DEFAULT_PLAYLIST_NAME)];

  const storedActive = str(value.activePlaylistId);
  const activePlaylistId = playlists.some((p) => p.id === storedActive) ? storedActive! : playlists[0]!.id;
  return { workspace: { playlists, activePlaylistId, settings }, dropped: seen - kept };
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

function sanitizeTrack(value: unknown, preference: ExplicitPreference): Track | undefined {
  if (!isRecord(value)) return undefined;
  const id = str(value.id);
  const artist = str(value.artist) ?? '';
  const title = str(value.title) ?? '';
  if (!id || (!artist && !title)) return undefined;
  const status = PURCHASE_STATUSES.includes(value.status as PurchaseStatus) ? (value.status as PurchaseStatus) : 'not_started';
  const source = SOURCES.includes(value.source as TrackSource) ? (value.source as TrackSource) : 'manual';
  const request: MatchRequest = {
    artist, title, album: str(value.album), durationMs: num(value.durationMs), isrc: str(value.isrc),
    explicit: typeof value.explicit === 'boolean' ? value.explicit : undefined,
  };
  return {
    id,
    ...request,
    spotifyUrl: safeSpotifyTrackUrl(value.spotifyUrl),
    source,
    status,
    addedAt: num(value.addedAt) ?? 0,
    parseWarning: str(value.parseWarning),
    searchOverride: str(value.searchOverride),
    match: sanitizeMatch(value.match, request, preference),
  };
}

function sanitizeMatch(value: unknown, request: MatchRequest, preference: ExplicitPreference): MatchState {
  if (!isRecord(value)) return { phase: 'queued', candidates: [] };
  const phase = value.phase;
  const done = phase === 'done';
  const error = phase === 'error';
  const recordings = done && Array.isArray(value.candidates)
    ? value.candidates.map(sanitizeRecording).filter((r): r is CatalogRecording => Boolean(r))
    : [];
  // Ratings and reasons are recomputed so they always follow the current matching rules.
  const candidates = rankCandidates(request, recordings, preference).slice(0, MAX_STORED_CANDIDATES);
  const selectedId = str(value.selectedId);
  const userSelected = value.userSelected === true && candidates.some((c) => c.recording.id === selectedId);
  return {
    // Anything that wasn't finished is looked up again.
    phase: done ? 'done' : error ? 'error' : 'queued',
    signature: done || error ? str(value.signature) : undefined,
    candidates,
    selectedId: userSelected ? selectedId : candidates[0]?.recording.id,
    userSelected: userSelected ? true : undefined,
    error: error ? str(value.error) : undefined,
    searchedAt: num(value.searchedAt),
  };
}

/** Accepts a stored candidate (`{ recording }`) from any schema version. */
function sanitizeRecording(value: unknown): CatalogRecording | undefined {
  if (!isRecord(value) || !isRecord(value.recording)) return undefined;
  const r = value.recording;
  const id = str(r.id);
  const title = str(r.title);
  const artist = str(r.artist);
  if (!id || !title || !artist) return undefined;
  const explicitness = r.explicitness;
  return {
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
}

function httpsOnly(url: string | undefined): string | undefined {
  return url && url.startsWith('https://') ? url : undefined;
}
