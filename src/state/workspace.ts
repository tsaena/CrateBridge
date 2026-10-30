import type {
  MatchState,
  PurchaseStatus,
  RankedCandidate,
  Track,
  TrackDraft,
  TrackSource,
  Workspace,
  WorkspaceSettings,
} from '../types';
import { rankCandidates } from '../lib/matching/rank';

export const DEFAULT_SETTINGS: WorkspaceSettings = {
  country: 'US',
  explicitPreference: 'any',
  searchModifiers: [],
  autoMatch: true,
};

export const emptyWorkspace = (): Workspace => ({ tracks: [], settings: { ...DEFAULT_SETTINGS } });

export type WorkspaceAction =
  | { type: 'import'; drafts: TrackDraft[]; source: TrackSource }
  | { type: 'update'; id: string; changes: Partial<Pick<Track, 'artist' | 'title' | 'album' | 'searchOverride'>> }
  | { type: 'delete'; ids: string[] }
  | { type: 'restore'; entries: { track: Track; index: number }[] }
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

export function createId(): string {
  idCounter += 1;
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `t_${Date.now().toString(36)}_${random}_${idCounter}`;
}

export function draftToTrack(draft: TrackDraft, source: TrackSource, now = Date.now()): Track {
  return {
    id: createId(),
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
    case 'import': {
      const now = Date.now();
      const added = action.drafts
        .filter((d) => d.title.trim() || d.artist.trim())
        .map((d) => draftToTrack(d, action.source, now));
      return added.length ? { ...state, tracks: [...state.tracks, ...added] } : state;
    }

    case 'update':
      return mapTrack(state, action.id, (track) => {
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
      return { ...state, tracks: state.tracks.filter((t) => !ids.has(t.id)) };
    }

    case 'restore': {
      const existing = new Set(state.tracks.map((t) => t.id));
      const tracks = [...state.tracks];
      [...action.entries]
        .filter((e) => !existing.has(e.track.id))
        .sort((a, b) => a.index - b.index)
        .forEach(({ track, index }) => tracks.splice(Math.min(index, tracks.length), 0, track));
      return { ...state, tracks };
    }

    case 'setStatus': {
      const ids = new Set(action.ids);
      return {
        ...state,
        tracks: state.tracks.map((t) => (ids.has(t.id) && t.status !== action.status ? { ...t, status: action.status } : t)),
      };
    }

    case 'resetAllStatuses':
      return { ...state, tracks: state.tracks.map((t) => (t.status === 'not_started' ? t : { ...t, status: 'not_started' })) };

    case 'clear':
      return { ...state, tracks: [] };

    case 'requeue': {
      const ids = action.ids ? new Set(action.ids) : undefined;
      return {
        ...state,
        tracks: state.tracks.map((t) => {
          if (ids && !ids.has(t.id)) return t;
          if (action.onlyFailed && t.match.phase !== 'error') return t;
          return { ...t, match: { ...queuedMatch(), selectedId: t.match.selectedId, userSelected: t.match.userSelected } };
        }),
      };
    }

    case 'matchStarted':
      return mapTrack(state, action.id, (t) => ({
        ...t,
        match: { ...t.match, phase: 'searching', signature: action.signature, error: undefined },
      }));

    case 'matchResolved':
      return mapTrack(state, action.id, (t) => {
        // Ignore results for a request that has since been edited or re-queued.
        if (t.match.signature !== action.signature || t.match.phase !== 'searching') return t;
        const keepSelection =
          t.match.userSelected && action.candidates.some((c) => c.recording.id === t.match.selectedId);
        return {
          ...t,
          match: {
            phase: 'done',
            signature: action.signature,
            candidates: action.candidates,
            selectedId: keepSelection ? t.match.selectedId : action.candidates[0]?.recording.id,
            userSelected: keepSelection ? true : undefined,
            searchedAt: action.at,
          },
        };
      });

    case 'matchFailed':
      return mapTrack(state, action.id, (t) => {
        if (t.match.signature !== action.signature || t.match.phase !== 'searching') return t;
        return { ...t, match: { ...t.match, phase: 'error', error: action.error } };
      });

    case 'selectCandidate':
      return mapTrack(state, action.id, (t) =>
        t.match.candidates.some((c) => c.recording.id === action.candidateId)
          ? { ...t, match: { ...t.match, selectedId: action.candidateId, userSelected: true } }
          : t,
      );

    case 'updateSettings': {
      const settings = { ...state.settings, ...action.changes };
      let tracks = state.tracks;
      if (settings.country !== state.settings.country) {
        // Prices and listings differ per storefront, so every match is looked up again.
        tracks = tracks.map((t) => ({ ...t, match: queuedMatch() }));
      } else if (settings.explicitPreference !== state.settings.explicitPreference) {
        tracks = tracks.map((t) => rerank(t, settings));
      }
      return { ...state, settings, tracks };
    }

    case 'replace':
      return action.workspace;
  }
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

function mapTrack(state: Workspace, id: string, fn: (track: Track) => Track): Workspace {
  let changed = false;
  const tracks = state.tracks.map((t) => {
    if (t.id !== id) return t;
    const next = fn(t);
    if (next !== t) changed = true;
    return next;
  });
  return changed ? { ...state, tracks } : state;
}

export function selectedCandidate(track: Track): RankedCandidate | undefined {
  const { candidates, selectedId } = track.match;
  return candidates.find((c) => c.recording.id === selectedId) ?? candidates[0];
}
