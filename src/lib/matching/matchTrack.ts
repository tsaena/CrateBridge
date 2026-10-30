import type { ExplicitPreference, RankedCandidate, Track } from '../../types';
import type { CatalogSearchService } from '../catalog/searchService';
import { SOFT_VERSION_TAGS, analyzeTitle, primaryArtist, splitTitle, stripFeatured } from '../normalize';
import { rankCandidates } from './rank';

/** Number of ranked candidates kept per track (persisted, so kept small). */
export const MAX_STORED_CANDIDATES = 8;

/**
 * Catalog queries for a track, most specific first. The second query is only
 * sent when the first returns nothing.
 */
export function catalogQueries(track: Pick<Track, 'artist' | 'title' | 'searchOverride'>): string[] {
  const override = track.searchOverride?.trim();
  if (override) return [override];

  const artist = primaryArtist(track.artist);
  const analysis = analyzeTitle(track.title);
  const coreQuery = join(artist, analysis.displayCore);
  const hasHardVersion = analysis.tags.some((t) => !SOFT_VERSION_TAGS.has(t));

  const queries: string[] = [];
  if (hasHardVersion) {
    // Keep remix/extended/live wording so the requested version is in the result set.
    const qualifiers = splitTitle(stripFeatured(track.title)).qualifiers;
    queries.push(join(artist, analysis.displayCore, ...qualifiers));
  }
  queries.push(coreQuery);
  if (artist && !hasHardVersion) queries.push(analysis.displayCore);
  return [...new Set(queries.filter(Boolean))].slice(0, 2);
}

/** Identifies the inputs a match was computed from, so stale results can be discarded. */
export function matchSignature(track: Pick<Track, 'artist' | 'title' | 'album' | 'durationMs' | 'isrc' | 'searchOverride'>, country: string): string {
  return JSON.stringify([
    country.toUpperCase(),
    track.artist.trim(),
    track.title.trim(),
    track.album?.trim() ?? '',
    track.durationMs ?? 0,
    track.isrc ?? '',
    track.searchOverride?.trim() ?? '',
  ]);
}

export async function findMatches(
  track: Track,
  service: CatalogSearchService,
  options: { country: string; preference: ExplicitPreference; signal?: AbortSignal; priority?: boolean },
): Promise<RankedCandidate[]> {
  const queries = catalogQueries(track);
  for (const term of queries) {
    const recordings = await service.search({ term, country: options.country }, options);
    if (recordings.length > 0) {
      return rankCandidates(track, recordings, options.preference).slice(0, MAX_STORED_CANDIDATES);
    }
  }
  return [];
}

function join(...parts: string[]): string {
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ');
}
