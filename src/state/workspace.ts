import type {
  MatchState,
  Playlist,
  PurchaseStatus,
  RankedCandidate,
  Track,
  TrackDraft,
  TrackSource,
  Workspace,
  WorkspaceSettings,
} from '../types';
import { rankCandidates } from '../lib/matching/rank';
import { MAX_STORED_CANDIDATES } from '../lib/matching/matchTrack';
import { safeSpotifyTrackUrl } from '../lib/spotify/import';

export const DEFAULT_SETTINGS: WorkspaceSettings = {
  country: 'US',
  explicitPreference: 'any',
  searchModifiers: [],
  autoMatch: true,
};

export const DEFAULT_PLAYLIST_NAME = 'My playlist';
export const MAX_PLAYLIST_NAME_LENGTH = 60;

export function newPlaylist(name: string, now = Date.now()): Playlist {
  return { id: createId('p'), name, createdAt: now, tracks: [] };
}

export function emptyWorkspace(): Workspace {
  const playlist = newPlaylist(DEFAULT_PLAYLIST_NAME);
  return { playlists: [playlist], activePlaylistId: playlist.id, settings: { ...DEFAULT_SETTINGS } };
}

export function activePlaylist(state: Pick<Workspace, 'playlists' | 'activePlaylistId'>): Playlist {
  // The reducer keeps activePlaylistId valid; the fallback only guards bad input.
  return state.playlists.find((p) => p.id === state.activePlaylistId) ?? state.playlists[0]!;
}

/** Every track, active playlist first, so background matching starts with what's on screen. */
export function allTracks(state: Pick<Workspace, 'playlists' | 'activePlaylistId'>): Track[] {
  const active = activePlaylist(state);
  return [...active.tracks, ...state.playlists.filter((p) => p !== active).flatMap((p) => p.tracks)];
}

export type WorkspaceAction =
  | { type: 'createPlaylist'; name?: string }
  | { type: 'renamePlaylist'; id: string; name: string }
  | { type: 'switchPlaylist'; id: string }
  | { type: 'deletePlaylist'; id: string }
  | { type: 'restorePlaylist'; playlist: Playlist; index: number; active: boolean; country: string }
  | { type: 'import'; drafts: TrackDraft[]; source: TrackSource }
  | { type: 'update'; id: string; changes: Partial<Pick<Track, 'artist' | 'title' | 'album' | 'searchOverride'>> }
  | { type: 'delete'; ids: string[] }
  | { type: 'restore'; entries: { track: Track; index: number; playlistId: string }[] }
  | { type: 'setStatus'; ids: string[]; status: PurchaseStatus }
  | { type: 'resetAllStatuses' }
  | { type: 'clear' }
  | { type: 'requeue'; ids?: string[]; onlyFailed?: boolean }
  | { type: 'matchStarted'; id: string; signature: string }
  | { type: 'matchResolved'; id: string; signature: string; candidates: RankedCandidate[]; at: number }
  | { type: 'matchFailed'; id: string; signature: string; error: string }
  | { type: 'selectCandidate'; id: string; candidateId: string }
  | { type: 'updateSettings'; changes: Partial<WorkspaceSettings> }
  | { type: 'replace'; workspace: Workspace };

let idCounter = 0;

export function createId(prefix = 't'): string {
  idCounter += 1;
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${random}_${idCounter}`;
}

export function draftToTrack(draft: TrackDraft, source: TrackSource, now = Date.now()): Track {
  return {
    id: createId(),
    spotifyUrl: safeSpotifyTrackUrl(draft.spotifyUrl),
    explicit: draft.explicit,
    artist: draft.artist.trim(),
    title: draft.title.trim(),
    album: draft.album?.trim() || undefined,
    durationMs: draft.durationMs,
    isrc: draft.isrc?.trim() || undefined,
    source,
    status: 'not_started',
    addedAt: now,
    parseWarning: draft.warning,
    match: { phase: 'queued', candidates: [] },
  };
}

const queuedMatch = (): MatchState => ({ phase: 'queued', candidates: [] });

export function workspaceReducer(state: Workspace, action: WorkspaceAction): Workspace {
  switch (action.type) {
    case 'createPlaylist': {
      const playlist = newPlaylist(cleanName(action.name) ?? nextPlaylistName(state));
      return { ...state, playlists: [...state.playlists, playlist], activePlaylistId: playlist.id };
    }

    case 'renamePlaylist': {
      const name = cleanName(action.name);
      if (!name) return state;
      return mapPlaylists(state, (p) => (p.id === action.id && p.name !== name ? { ...p, name } : p));
    }

    case 'switchPlaylist':
      return state.playlists.some((p) => p.id === action.id) && action.id !== state.activePlaylistId
        ? { ...state, activePlaylistId: action.id }
        : state;

    case 'deletePlaylist': {
      const index = state.playlists.findIndex((p) => p.id === action.id);
      if (index < 0) return state;
      const playlists = state.playlists.filter((p) => p.id !== action.id);
      // There is always a playlist to show; deleting the last one leaves an empty default.
      if (playlists.length === 0) playlists.push(newPlaylist(DEFAULT_PLAYLIST_NAME));
      const activePlaylistId =
        state.activePlaylistId === action.id ? playlists[Math.max(0, index - 1)]!.id : state.activePlaylistId;
      return { ...state, playlists, activePlaylistId };
    }

    case 'restorePlaylist': {
      if (state.playlists.some((p) => p.id === action.playlist.id)) return state;
      // Deleting a playlist cancels its lookups, so undo starts them again.
      // Shared settings may have changed while this snapshot was outside state.
      const playlist = {
        ...action.playlist,
        tracks: action.playlist.tracks.map((track) =>
          action.country !== state.settings.country
            ? { ...track, match: queuedMatch() }
            : rerank(requeueIfSearching(track), state.settings),
        ),
      };
      const playlists = [...state.playlists];
      playlists.splice(Math.min(action.index, playlists.length), 0, playlist);
      return { ...state, playlists, activePlaylistId: action.active ? playlist.id : state.activePlaylistId };
    }

    case 'import': {
      const now = Date.now();
      const added = action.drafts
        .filter((d) => d.title.trim() || d.artist.trim())
        .map((d) => draftToTrack(d, action.source, now));
      return added.length ? mapActive(state, (tracks) => [...tracks, ...added]) : state;
    }

    case 'update':
      return mapTracks(state, (track) => {
        if (track.id !== action.id) return track;
        const next: Track = { ...track, ...action.changes };
        next.artist = next.artist.trim();
        next.title = next.title.trim();
        next.album = next.album?.trim() || undefined;
        next.searchOverride = next.searchOverride?.trim() || undefined;
        const identityChanged =
          next.artist !== track.artist ||
          next.title !== track.title ||
          next.album !== track.album ||
          next.searchOverride !== track.searchOverride;
        if (!identityChanged) return track;
        // An edited track is a new request: clear the old warning and look it up again.
        return { ...next, parseWarning: next.artist && next.title ? undefined : track.parseWarning, match: queuedMatch() };
      });

    case 'delete': {
      const ids = new Set(action.ids);
      return mapPlaylists(state, (p) =>
        p.tracks.some((t) => ids.has(t.id)) ? { ...p, tracks: p.tracks.filter((t) => !ids.has(t.id)) } : p,
      );
    }

    case 'restore': {
      const existing = new Set(allTracks(state).map((t) => t.id));
      const entries = [...action.entries].filter((e) => !existing.has(e.track.id)).sort((a, b) => a.index - b.index);
      return mapPlaylists(state, (p) => {
        const mine = entries.filter((e) => e.playlistId === p.id);
        if (mine.length === 0) return p;
        const tracks = [...p.tracks];
        // Removing a track cancels its lookup; undo must start a fresh request.
        mine.forEach(({ track, index }) => tracks.splice(Math.min(index, tracks.length), 0, requeueIfSearching(track)));
        return { ...p, tracks };
      });
    }

    case 'setStatus': {
      const ids = new Set(action.ids);
      return mapTracks(state, (t) => (ids.has(t.id) && t.status !== action.status ? { ...t, status: action.status } : t));
    }

    case 'resetAllStatuses':
      return mapActive(state, (tracks) => tracks.map((t) => (t.status === 'not_started' ? t : { ...t, status: 'not_started' })));

    case 'clear':
      return mapActive(state, (tracks) => (tracks.length ? [] : tracks));

    case 'requeue': {
      const ids = action.ids ? new Set(action.ids) : undefined;
      const requeue = (t: Track) => {
        if (ids && !ids.has(t.id)) return t;
        if (action.onlyFailed && t.match.phase !== 'error') return t;
        return requeueTrack(t);
      };
      // Without ids, this is the active playlist's "retry" action.
      return ids ? mapTracks(state, requeue) : mapActive(state, (tracks) => tracks.map(requeue));
    }

    case 'matchStarted':
      return mapTracks(state, (t) =>
        t.id === action.id ? { ...t, match: { ...t.match, phase: 'searching', signature: action.signature, error: undefined } } : t,
      );

    case 'matchResolved':
      return mapTracks(state, (t) => {
        // Ignore results for a request that has since been edited or re-queued.
        if (t.id !== action.id || t.match.signature !== action.signature || t.match.phase !== 'searching') return t;
        // Preferences can change while the request is running. Rank the full
        // result set with current settings before limiting persisted candidates.
        const candidates = rankCandidates(
          t, action.candidates.map((c) => c.recording), state.settings.explicitPreference,
        ).slice(0, MAX_STORED_CANDIDATES);
        const keepSelection =
          t.match.userSelected && candidates.some((c) => c.recording.id === t.match.selectedId);
        return {
          ...t,
          match: {
            phase: 'done',
            signature: action.signature,
            candidates,
            selectedId: keepSelection ? t.match.selectedId : candidates[0]?.recording.id,
            userSelected: keepSelection ? true : undefined,
            searchedAt: action.at,
          },
        };
      });

    case 'matchFailed':
      return mapTracks(state, (t) => {
        if (t.id !== action.id || t.match.signature !== action.signature || t.match.phase !== 'searching') return t;
        return { ...t, match: { ...t.match, phase: 'error', error: action.error } };
      });

    case 'selectCandidate':
      return mapTracks(state, (t) =>
        t.id === action.id && t.match.candidates.some((c) => c.recording.id === action.candidateId)
          ? { ...t, match: { ...t.match, selectedId: action.candidateId, userSelected: true } }
          : t,
      );

    case 'updateSettings': {
      const settings = { ...state.settings, ...action.changes };
      let next = { ...state, settings };
      if (settings.country !== state.settings.country) {
        // Prices and listings differ per storefront, so every match is looked up again.
        next = mapTracks(next, (t) => ({ ...t, match: queuedMatch() }));
      } else if (settings.explicitPreference !== state.settings.explicitPreference) {
        next = mapTracks(next, (t) => rerank(t, settings));
      }
      return next;
    }

    case 'replace':
      return action.workspace;
  }
}

function cleanName(name: string | undefined): string | undefined {
  const trimmed = name?.replace(/\s+/g, ' ').trim().slice(0, MAX_PLAYLIST_NAME_LENGTH);
  return trimmed || undefined;
}

function nextPlaylistName(state: Workspace): string {
  const names = new Set(state.playlists.map((p) => p.name));
  let n = state.playlists.length + 1;
  while (names.has(`Playlist ${n}`)) n += 1;
  return `Playlist ${n}`;
}

function requeueIfSearching(track: Track): Track {
  return track.match.phase === 'searching' ? requeueTrack(track) : track;
}

function requeueTrack(track: Track): Track {
  return {
    ...track,
    match: { ...queuedMatch(), selectedId: track.match.selectedId, userSelected: track.match.userSelected },
  };
}

function rerank(track: Track, settings: WorkspaceSettings): Track {
  if (track.match.phase !== 'done' || track.match.candidates.length === 0) return track;
  const candidates = rankCandidates(
    track,
    track.match.candidates.map((c) => c.recording),
    settings.explicitPreference,
  );
  return {
    ...track,
    match: {
      ...track.match,
      candidates,
      selectedId: track.match.userSelected ? track.match.selectedId : candidates[0]?.recording.id,
    },
  };
}

function mapPlaylists(state: Workspace, fn: (playlist: Playlist) => Playlist): Workspace {
  let changed = false;
  const playlists = state.playlists.map((p) => {
    const next = fn(p);
    if (next !== p) changed = true;
    return next;
  });
  return changed ? { ...state, playlists } : state;
}

/** Applies `fn` to every track in every playlist, keeping unchanged objects identical. */
function mapTracks(state: Workspace, fn: (track: Track) => Track): Workspace {
  return mapPlaylists(state, (p) => {
    let changed = false;
    const tracks = p.tracks.map((t) => {
      const next = fn(t);
      if (next !== t) changed = true;
      return next;
    });
    return changed ? { ...p, tracks } : p;
  });
}

function mapActive(state: Workspace, fn: (tracks: Track[]) => Track[]): Workspace {
  const active = activePlaylist(state);
  return mapPlaylists(state, (p) => {
    if (p !== active) return p;
    const tracks = fn(p.tracks);
    return tracks === p.tracks ? p : { ...p, tracks };
  });
}

export function selectedCandidate(track: Track): RankedCandidate | undefined {
  const { candidates, selectedId } = track.match;
  return candidates.find((c) => c.recording.id === selectedId) ?? candidates[0];
}
