import Papa from 'papaparse';
import type { PurchaseStatus, RankedCandidate, Track } from '../types';
import { isPurchasable } from '../lib/matching/rank';
import { formatDuration } from '../lib/normalize';
import { selectedCandidate } from './workspace';

/** How a track's catalog match should be presented. */
export type MatchClass = 'pending' | 'error' | 'confirmed' | 'high' | 'review' | 'none';

export function matchClass(track: Track): MatchClass {
  const { phase, userSelected } = track.match;
  if (phase === 'queued' || phase === 'searching' || phase === 'idle') return 'pending';
  if (phase === 'error') return 'error';
  const selected = selectedCandidate(track);
  if (!selected) return 'none';
  if (userSelected) return 'confirmed';
  return selected.confidence;
}

/** The kind of destination the primary link leads to. */
export type ListingKind = 'verified' | 'unverified' | 'none';

export function listingKind(candidate: RankedCandidate | undefined): ListingKind {
  if (!candidate?.recording.listingUrl) return 'none';
  return isPurchasable(candidate.recording) ? 'verified' : 'unverified';
}

export interface CostTotal {
  currency: string;
  amount: number;
  count: number;
}

export interface WorkspaceSummary {
  total: number;
  likely: number;
  review: number;
  pending: number;
  purchased: number;
  found: number;
  skipped: number;
  remaining: number;
  /** Known prices of selected versions for tracks not yet purchased or skipped. */
  remainingCost: CostTotal[];
  /** Known prices of everything marked purchased. */
  spentCost: CostTotal[];
  /** Remaining tracks without a known price. */
  unpricedRemaining: number;
}

export function summarize(tracks: Track[]): WorkspaceSummary {
  const summary: WorkspaceSummary = {
    total: tracks.length,
    likely: 0,
    review: 0,
    pending: 0,
    purchased: 0,
    found: 0,
    skipped: 0,
    remaining: 0,
    remainingCost: [],
    spentCost: [],
    unpricedRemaining: 0,
  };
  const remaining = new Map<string, CostTotal>();
  const spent = new Map<string, CostTotal>();

  for (const track of tracks) {
    const cls = matchClass(track);
    if (cls === 'high' || cls === 'confirmed') summary.likely += 1;
    else if (cls === 'pending') summary.pending += 1;
    else summary.review += 1;

    if (track.status === 'purchased') summary.purchased += 1;
    if (track.status === 'skipped') summary.skipped += 1;
    if (track.status === 'found') summary.found += 1;

    const recording = selectedCandidate(track)?.recording;
    const priced = recording?.price !== undefined && recording.currency ? recording : undefined;
    if (track.status === 'purchased') {
      if (priced) addCost(spent, priced.currency!, priced.price!);
    } else if (track.status !== 'skipped') {
      summary.remaining += 1;
      if (priced) addCost(remaining, priced.currency!, priced.price!);
      else summary.unpricedRemaining += 1;
    }
  }
  summary.remainingCost = [...remaining.values()];
  summary.spentCost = [...spent.values()];
  return summary;
}

function addCost(map: Map<string, CostTotal>, currency: string, amount: number) {
  const entry = map.get(currency) ?? { currency, amount: 0, count: 0 };
  entry.amount = Math.round((entry.amount + amount) * 100) / 100;
  entry.count += 1;
  map.set(currency, entry);
}

export function formatPrice(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

export function formatCosts(costs: CostTotal[]): string {
  if (costs.length === 0) return formatPrice(0, 'USD');
  return costs.map((c) => formatPrice(c.amount, c.currency)).join(' + ');
}

// ---------------------------------------------------------------------------
// Filtering and sorting

export type StatusFilter = 'all' | PurchaseStatus | 'remaining';
export type MatchFilter = 'all' | 'likely' | 'review' | 'pending';
export type SortKey = 'order' | 'artist' | 'title' | 'status' | 'confidence' | 'price';

export interface ViewOptions {
  query: string;
  status: StatusFilter;
  match: MatchFilter;
  sort: SortKey;
}

export const DEFAULT_VIEW: ViewOptions = { query: '', status: 'all', match: 'all', sort: 'order' };

const STATUS_ORDER: Record<PurchaseStatus, number> = { not_started: 0, found: 1, purchased: 2, skipped: 3 };
// Tracks that need attention sort first.
const CONFIDENCE_ORDER: Record<MatchClass, number> = { error: 0, none: 1, review: 2, pending: 3, high: 4, confirmed: 5 };

export function filterAndSort(tracks: Track[], view: ViewOptions): Track[] {
  const query = view.query.trim().toLowerCase();
  const filtered = tracks.filter((track) => {
    if (view.status === 'remaining' && (track.status === 'purchased' || track.status === 'skipped')) return false;
    if (view.status !== 'all' && view.status !== 'remaining' && track.status !== view.status) return false;
    const cls = matchClass(track);
    if (view.match === 'likely' && cls !== 'high' && cls !== 'confirmed') return false;
    if (view.match === 'review' && !(cls === 'review' || cls === 'none' || cls === 'error')) return false;
    if (view.match === 'pending' && cls !== 'pending') return false;
    if (query) {
      const recording = selectedCandidate(track)?.recording;
      const haystack = [track.artist, track.title, track.album, recording?.album].join(' ').toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  if (view.sort === 'order') return filtered;
  const indexOf = new Map(tracks.map((t, i) => [t.id, i]));
  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
  const price = (t: Track) => selectedCandidate(t)?.recording.price ?? Number.POSITIVE_INFINITY;
  return [...filtered].sort((a, b) => {
    let result = 0;
    switch (view.sort) {
      case 'artist':
        result = collator.compare(a.artist, b.artist) || collator.compare(a.title, b.title);
        break;
      case 'title':
        result = collator.compare(a.title, b.title);
        break;
      case 'status':
        result = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
        break;
      case 'confidence':
        result = CONFIDENCE_ORDER[matchClass(a)] - CONFIDENCE_ORDER[matchClass(b)];
        break;
      case 'price':
        result = price(a) - price(b);
        break;
    }
    return result || indexOf.get(a.id)! - indexOf.get(b.id)!;
  });
}

// ---------------------------------------------------------------------------
// Export

export const STATUS_LABELS: Record<PurchaseStatus, string> = {
  not_started: 'Not Started',
  found: 'Found',
  purchased: 'Purchased',
  skipped: 'Skipped',
};

const MATCH_LABELS: Record<MatchClass, string> = {
  pending: 'Searching',
  error: 'Search failed',
  confirmed: 'Selected by you',
  high: 'High confidence',
  review: 'Review suggested',
  none: 'No reliable match',
};

export function exportChecklistCsv(tracks: Track[]): string {
  const rows = tracks.map((track) => {
    const candidate = selectedCandidate(track);
    const recording = candidate?.recording;
    return {
      Artist: track.artist,
      Title: track.title,
      Status: STATUS_LABELS[track.status],
      Match: MATCH_LABELS[matchClass(track)],
      'Selected Recording': recording ? `${recording.artist} – ${recording.title}` : '',
      Album: recording?.album ?? track.album ?? '',
      Duration: recording?.durationMs ? formatDuration(recording.durationMs) : '',
      Explicitness: recording ? recording.explicitness.replace('_', ' ') : '',
      Price: recording?.price !== undefined ? recording.price.toFixed(2) : '',
      Currency: recording?.price !== undefined ? (recording.currency ?? '') : '',
      'Store Link': recording?.listingUrl ?? '',
      'Link Type': listingKindLabel(listingKind(candidate)),
    };
  });
  // Neutralize spreadsheet formula injection from user-entered or catalog text.
  const safe = rows.map((row) =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k, /^[=+\-@\t\r]/.test(v) ? `'${v}` : v])),
  );
  return Papa.unparse(safe, { quotes: true });
}

function listingKindLabel(kind: ListingKind): string {
  switch (kind) {
    case 'verified':
      return 'Verified iTunes Store listing';
    case 'unverified':
      return 'Catalog listing (no individual price)';
    case 'none':
      return '';
  }
}
