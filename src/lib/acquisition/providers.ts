import type { Track } from '../../types';
import { SEARCH_LINK_PROVIDERS, searchTermFor } from '../providers/searchLinks';

/**
 * Where a track can be acquired, and how CrateBridge can reach each provider.
 * Access levels follow the README's "Store and DJ pool access" table
 * (checked 2026-11-06): only iTunes has a catalog API a static app may query.
 */
export type AcquisitionProviderId = 'itunes' | 'amazon' | 'beatport' | 'bandcamp' | 'djcity' | 'bpm-supreme' | 'zipdj';
export type PoolId = Extract<AcquisitionProviderId, 'djcity' | 'bpm-supreme' | 'zipdj'>;

/**
 * - `catalog-api`: CrateBridge looks the recording up and can verify a listing.
 * - `search-link`: a labelled link to the provider's public search page, opened by the user.
 * - `entry-point`: a link to the provider's site where no public search page is known.
 */
export type ProviderAccess = 'catalog-api' | 'search-link' | 'entry-point';

export interface AcquisitionProvider {
  id: AcquisitionProviderId;
  name: string;
  kind: 'store' | 'pool';
  access: ProviderAccess;
  /** Why access is limited, shown next to the provider. */
  note: string;
  /** The provider's public search page for a track (search-link providers). */
  searchUrl?: (track: Track, country: string, modifiers: string[]) => string;
  /** The provider's site (entry-point providers). */
  entryUrl?: string;
}

function searchLink(id: string): AcquisitionProvider['searchUrl'] {
  const provider = SEARCH_LINK_PROVIDERS.find((p) => p.id === id);
  if (!provider) throw new Error(`Unknown search link provider: ${id}`);
  return (track, country, modifiers) => provider.buildUrl(searchTermFor(track, modifiers), country);
}

export const ACQUISITION_PROVIDERS: readonly AcquisitionProvider[] = [
  {
    id: 'itunes',
    name: 'iTunes Store',
    kind: 'store',
    access: 'catalog-api',
    note: 'Checked against Apple’s catalog',
  },
  {
    id: 'amazon',
    name: 'Amazon Digital Music',
    kind: 'store',
    access: 'search-link',
    note: 'No public catalog access (closed beta API)',
    searchUrl: searchLink('amazon'),
  },
  {
    id: 'beatport',
    name: 'Beatport',
    kind: 'store',
    access: 'search-link',
    note: 'API limited to approved licensees',
    searchUrl: searchLink('beatport'),
  },
  {
    id: 'bandcamp',
    name: 'Bandcamp',
    kind: 'store',
    access: 'search-link',
    note: 'No catalog API',
    searchUrl: searchLink('bandcamp'),
  },
  {
    id: 'djcity',
    name: 'DJcity',
    kind: 'pool',
    access: 'entry-point',
    note: 'Membership pool with no public API; tracks expire after about 6–12 months',
    entryUrl: 'https://www.djcity.com/',
  },
  {
    id: 'bpm-supreme',
    name: 'BPM Supreme',
    kind: 'pool',
    access: 'entry-point',
    note: 'Membership pool with no public API; some libraries need a higher plan',
    entryUrl: 'https://www.bpmsupreme.com/',
  },
  {
    id: 'zipdj',
    name: 'ZIPDJ',
    kind: 'pool',
    access: 'entry-point',
    note: 'Membership pool with no public API',
    entryUrl: 'https://www.zipdj.com/',
  },
];

export const POOL_IDS: readonly PoolId[] = ['djcity', 'bpm-supreme', 'zipdj'];

export function isProviderId(value: unknown): value is AcquisitionProviderId {
  return ACQUISITION_PROVIDERS.some((p) => p.id === value);
}

export function isPoolId(value: unknown): value is PoolId {
  return POOL_IDS.includes(value as PoolId);
}

export function providerById(id: AcquisitionProviderId): AcquisitionProvider {
  return ACQUISITION_PROVIDERS.find((p) => p.id === id)!;
}

/** Pools the user says they belong to come first; this is a local preference, not an account check. */
export function orderedPools(poolsIUse: readonly PoolId[]): AcquisitionProvider[] {
  const pools = ACQUISITION_PROVIDERS.filter((p) => p.kind === 'pool');
  return [...pools.filter((p) => poolsIUse.includes(p.id as PoolId)), ...pools.filter((p) => !poolsIUse.includes(p.id as PoolId))];
}
