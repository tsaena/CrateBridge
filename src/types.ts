/** Purchase progress, controlled manually by the user. */
export type PurchaseStatus = 'not_started' | 'found' | 'purchased' | 'skipped';

export const PURCHASE_STATUSES: readonly PurchaseStatus[] = [
  'not_started',
  'found',
  'purchased',
  'skipped',
];

export type TrackSource = 'paste' | 'csv' | 'manual' | 'sample' | 'spotify';

/**
 * Confidence classes derived from the deterministic ranking rules in
 * `lib/matching/rank.ts`. These are categories, not probabilities.
 */
export type Confidence = 'high' | 'review' | 'none';

export type ExplicitPreference = 'any' | 'explicit' | 'clean';

export type Explicitness = 'explicit' | 'clean' | 'not_explicit' | 'unknown';

/** Version descriptors that change which recording a listing represents. */
export type VersionTag =
  | 'remix'
  | 'live'
  | 'acoustic'
  | 'instrumental'
  | 'karaoke'
  | 'cover'
  | 'extended'
  | 'radio_edit'
  | 'remaster'
  | 'demo'
  | 'clean'
  | 'explicit'
  | 'original'
  | 'sped_up'
  | 'slowed'
  | 'edit'
  | 'alt_version';

/**
 * A recording from a retailer catalog, trimmed to the fields CrateBridge
 * needs. Kept small because a few of these are persisted per track.
 */
export interface CatalogRecording {
  /** Provider-scoped identifier, e.g. `itunes:1499378615`. */
  id: string;
  provider: 'itunes';
  title: string;
  artist: string;
  album?: string;
  artworkUrl?: string;
  durationMs?: number;
  explicitness: Explicitness;
  /** Price for the single track. Undefined when the store does not sell it individually. */
  price?: number;
  currency?: string;
  /** The retailer's own listing page for this exact recording. */
  listingUrl?: string;
  releaseDate?: string;
  genre?: string;
  isrc?: string;
  /** On a various-artists compilation rather than the artist's own release. */
  compilation?: boolean;
}

export interface MatchReason {
  /** Positive values support the match; negative values count against it. */
  effect: 'plus' | 'minus' | 'neutral';
  text: string;
}

export interface RankedCandidate {
  recording: CatalogRecording;
  /** Internal ordering score. Never shown as a probability. */
  score: number;
  confidence: Confidence;
  reasons: MatchReason[];
}

export type MatchPhase = 'idle' | 'queued' | 'searching' | 'done' | 'error';

export interface MatchState {
  phase: MatchPhase;
  /** Signature of the query that produced `candidates`; used to discard stale results. */
  signature?: string;
  candidates: RankedCandidate[];
  /** Recording the user will buy. Defaults to the top candidate. */
  selectedId?: string;
  /** True when the user explicitly picked `selectedId`. */
  userSelected?: boolean;
  error?: string;
  searchedAt?: number;
}

export interface Track {
  id: string;
  /** Explicit-content flag supplied by the import source; false does not imply a clean edit. */
  explicit?: boolean;
  /** Attribution for metadata imported from Spotify. */
  spotifyUrl?: string;
  artist: string;
  title: string;
  album?: string;
  durationMs?: number;
  isrc?: string;
  source: TrackSource;
  status: PurchaseStatus;
  addedAt: number;
  /** Shown when the import parser could not split the line confidently. */
  parseWarning?: string;
  /** Optional custom catalog query that replaces the generated one. */
  searchOverride?: string;
  match: MatchState;
}

export interface WorkspaceSettings {
  /** ISO 3166-1 alpha-2 storefront code, e.g. `US`. */
  country: string;
  explicitPreference: ExplicitPreference;
  /** Words appended to external store searches, e.g. "Extended". */
  searchModifiers: string[];
  autoMatch: boolean;
}

/** A named list of tracks to buy, e.g. one DJ set. */
export interface Playlist {
  id: string;
  name: string;
  createdAt: number;
  tracks: Track[];
}

export interface Workspace {
  /** Always at least one playlist. Track ids are unique across all playlists. */
  playlists: Playlist[];
  activePlaylistId: string;
  /** Shared by every playlist. */
  settings: WorkspaceSettings;
}

/** A track as produced by an importer, before it enters the workspace. */
export interface TrackDraft {
  explicit?: boolean;
  spotifyUrl?: string;
  artist: string;
  title: string;
  album?: string;
  durationMs?: number;
  isrc?: string;
  /** Explains why the row needs a human check. */
  warning?: string;
  /** The raw line, for display in import previews. */
  raw?: string;
}
