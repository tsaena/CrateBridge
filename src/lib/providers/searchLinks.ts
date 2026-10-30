import type { Track } from '../../types';
import { primaryArtist, stripFeatured } from '../normalize';

/**
 * Prefilled searches on external sites. These always work, even when the
 * iTunes Search API is unreachable, but they open search results rather than
 * a verified listing for one recording.
 */
export type SearchLinkKind = 'download-store' | 'streaming-catalog';

export interface SearchLinkProvider {
  id: string;
  name: string;
  kind: SearchLinkKind;
  /** One-line explanation shown next to the link. */
  note: string;
  buildUrl(term: string, country: string): string;
}

export interface Storefront {
  code: string;
  name: string;
  amazonDomain?: string;
}

/** Storefronts offered in settings. Any ISO code works with the iTunes API; these are common ones. */
export const STOREFRONTS: Storefront[] = [
  { code: 'US', name: 'United States', amazonDomain: 'amazon.com' },
  { code: 'CA', name: 'Canada', amazonDomain: 'amazon.ca' },
  { code: 'GB', name: 'United Kingdom', amazonDomain: 'amazon.co.uk' },
  { code: 'IE', name: 'Ireland' },
  { code: 'AU', name: 'Australia', amazonDomain: 'amazon.com.au' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'DE', name: 'Germany', amazonDomain: 'amazon.de' },
  { code: 'FR', name: 'France', amazonDomain: 'amazon.fr' },
  { code: 'ES', name: 'Spain', amazonDomain: 'amazon.es' },
  { code: 'IT', name: 'Italy', amazonDomain: 'amazon.it' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'SE', name: 'Sweden' },
  { code: 'JP', name: 'Japan', amazonDomain: 'amazon.co.jp' },
  { code: 'BR', name: 'Brazil' },
  { code: 'MX', name: 'Mexico' },
];

export function storefrontFor(code: string): Storefront | undefined {
  return STOREFRONTS.find((s) => s.code === code.toUpperCase());
}

const enc = encodeURIComponent;

export const SEARCH_LINK_PROVIDERS: SearchLinkProvider[] = [
  {
    id: 'amazon',
    name: 'Amazon Digital Music',
    kind: 'download-store',
    note: 'Search results for MP3 purchases',
    buildUrl: (term, country) => {
      const domain = storefrontFor(country)?.amazonDomain ?? 'amazon.com';
      return `https://www.${domain}/s?k=${enc(term)}&i=digital-music`;
    },
  },
  {
    id: 'beatport',
    name: 'Beatport',
    kind: 'download-store',
    note: 'DJ-focused download store search',
    buildUrl: (term) => `https://www.beatport.com/search?q=${enc(term)}`,
  },
  {
    id: 'bandcamp',
    name: 'Bandcamp',
    kind: 'download-store',
    note: 'Independent artists; track search',
    buildUrl: (term) => `https://bandcamp.com/search?q=${enc(term)}&item_type=t`,
  },
  {
    id: 'apple-music',
    name: 'Apple Music (web)',
    kind: 'streaming-catalog',
    note: 'Streaming catalog search — not an iTunes Store purchase page',
    buildUrl: (term, country) => `https://music.apple.com/${country.toLowerCase()}/search?term=${enc(term)}`,
  },
];

/** "Artist Title Extended" — the free-text query used for external searches. */
export function buildSearchTerm(artist: string, title: string, modifiers: string[] = []): string {
  return [artist, title, ...modifiers]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ');
}

export const SEARCH_MODIFIERS = ['Clean', 'Explicit', 'Extended', 'Radio Edit', 'Remix', 'Original Mix'] as const;

/** External search query for a track: primary artist, title without "feat." credits, plus modifiers. */
export function searchTermFor(track: Pick<Track, 'artist' | 'title'>, modifiers: string[]): string {
  return buildSearchTerm(primaryArtist(track.artist), stripFeatured(track.title), modifiers);
}
