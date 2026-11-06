import type { Track } from '../../types';
import { listingKind, matchClass } from '../../state/selectors';
import { selectedCandidate } from '../../state/workspace';
import type { AcquisitionProvider } from './providers';

/**
 * What CrateBridge knows about a provider having the requested recording.
 * This is separate from match confidence and from the user's own access:
 * a correct match isn't necessarily for sale, and a pool listing isn't proof
 * that the user can download it.
 */
export type EvidenceState =
  | 'checking'
  | 'verified'
  | 'possible'
  | 'not-found'
  | 'unable'
  | 'stale'
  | 'search-only'
  | 'membership';

export interface Evidence {
  state: EvidenceState;
  label: string;
  /** When the evidence was gathered, for catalog lookups. */
  checkedAt?: number;
}

/** Prices and listings change, so catalog evidence older than this needs a refresh. */
export const CATALOG_EVIDENCE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function evidenceFor(track: Track, provider: AcquisitionProvider, now = Date.now()): Evidence {
  if (provider.access === 'search-link') return { state: 'search-only', label: 'Search only, not checked' };
  if (provider.access === 'entry-point') return { state: 'membership', label: 'Membership required, not checked' };

  const { phase, searchedAt, error } = track.match;
  if (phase === 'queued' || phase === 'searching' || phase === 'idle') return { state: 'checking', label: 'Checking…' };
  if (phase === 'error') return { state: 'unable', label: error ? `Unable to check: ${error}` : 'Unable to check' };
  if (searchedAt !== undefined && now - searchedAt > CATALOG_EVIDENCE_TTL_MS) {
    return { state: 'stale', label: 'Checked over 30 days ago, refresh needed', checkedAt: searchedAt };
  }

  const candidate = selectedCandidate(track);
  if (!candidate) return { state: 'not-found', label: 'Not found in this lookup', checkedAt: searchedAt };
  const confident = ['high', 'confirmed'].includes(matchClass(track));
  // A verified listing needs both an individual track price and a confident match.
  if (listingKind(candidate) === 'verified' && confident) {
    return { state: 'verified', label: 'Verified listing', checkedAt: searchedAt };
  }
  return { state: 'possible', label: 'Possible match, review', checkedAt: searchedAt };
}
