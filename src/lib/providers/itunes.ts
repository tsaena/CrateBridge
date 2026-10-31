import type { CatalogRecording, Explicitness } from '../../types';
import { CatalogError, type CatalogProvider, type CatalogQuery } from './types';

/**
 * Apple's iTunes Search API.
 * Docs: https://performance-partners.apple.com/search-api
 * Search endpoint: https://itunes.apple.com/search
 *
 * Apple asks clients to stay around 20 calls per minute; pacing is handled by
 * `SearchQueue`, not here.
 */
export const ITUNES_SEARCH_ENDPOINT = 'https://itunes.apple.com/search';

/** Subset of the documented result fields that CrateBridge reads. */
export interface ItunesResult {
  wrapperType?: string;
  kind?: string;
  trackId?: number;
  trackName?: string;
  trackCensoredName?: string;
  artistName?: string;
  collectionName?: string;
  artworkUrl100?: string;
  artworkUrl60?: string;
  trackTimeMillis?: number;
  trackExplicitness?: string;
  trackPrice?: number;
  currency?: string;
  trackViewUrl?: string;
  releaseDate?: string;
  primaryGenreName?: string;
}

export interface ItunesResponse {
  resultCount?: number;
  results?: ItunesResult[];
}

export type JsonpLoader = (url: string, timeoutMs: number) => Promise<unknown>;

export interface ItunesProviderOptions {
  fetchImpl?: typeof fetch;
  /** Fallback transport used when `fetch` is blocked (e.g. by CORS). Pass `null` to disable. */
  jsonp?: JsonpLoader | null;
  timeoutMs?: number;
}

export function buildSearchUrl({ term, country, limit = 25 }: CatalogQuery): string {
  const params = new URLSearchParams({
    term,
    country: country.toUpperCase(),
    media: 'music',
    entity: 'song',
    limit: String(Math.min(Math.max(limit, 1), 200)),
  });
  return `${ITUNES_SEARCH_ENDPOINT}?${params.toString()}`;
}

export function createItunesProvider(options: ItunesProviderOptions = {}): CatalogProvider {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const jsonp = options.jsonp === undefined ? loadJsonp : options.jsonp;
  // After the first CORS-style failure, go straight to JSONP for the rest of the session.
  let preferJsonp = false;

  async function viaFetch(url: string, signal?: AbortSignal): Promise<unknown> {
    const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), timeoutMs);
    const onAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const response = await fetchImpl(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (response.status === 403 || response.status === 429) {
        throw new CatalogError('rate_limited', 'Apple is limiting requests right now.', response.status);
      }
      if (response.status >= 500) {
        throw new CatalogError('server', `Apple’s catalog returned an error (${response.status}).`, response.status);
      }
      if (!response.ok) {
        throw new CatalogError('bad_response', `Unexpected response from Apple (${response.status}).`, response.status);
      }
      return await response.json();
    } catch (error) {
      if (error instanceof CatalogError) throw error;
      if (signal?.aborted) throw new CatalogError('aborted', 'Search cancelled.');
      if (error instanceof SyntaxError) throw new CatalogError('bad_response', 'Apple returned unreadable data.');
      throw new CatalogError('network', 'Couldn’t reach Apple’s catalog.');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  return {
    id: 'itunes',
    name: 'iTunes Store',
    async search(query, signal) {
      const url = buildSearchUrl(query);
      let payload: unknown;
      if (preferJsonp && jsonp) {
        payload = await viaJsonp(jsonp, url, timeoutMs);
      } else {
        try {
          payload = await viaFetch(url, signal);
        } catch (error) {
          // A TypeError from fetch is indistinguishable from a CORS block; JSONP is Apple's documented alternative.
          if (!(error instanceof CatalogError) || error.kind !== 'network' || !jsonp || signal?.aborted) throw error;
          payload = await viaJsonp(jsonp, url, timeoutMs);
          preferJsonp = true;
        }
      }
      if (signal?.aborted) throw new CatalogError('aborted', 'Search cancelled.');
      return parseItunesResponse(payload);
    },
  };
}

async function viaJsonp(jsonp: JsonpLoader, url: string, timeoutMs: number): Promise<unknown> {
  try {
    return await jsonp(url, timeoutMs);
  } catch {
    // A failed script load hides the HTTP status. A 403 rate limit looks exactly
    // like this, so the caller backs off as if limited.
    throw new CatalogError('possibly_rate_limited', 'Apple’s catalog didn’t respond. It may be limiting requests.');
  }
}

export function parseItunesResponse(payload: unknown): CatalogRecording[] {
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as ItunesResponse).results)) {
    throw new CatalogError('bad_response', 'Apple returned an unexpected response.');
  }
  const results = (payload as ItunesResponse).results ?? [];
  const recordings: CatalogRecording[] = [];
  for (const item of results) {
    const recording = toRecording(item);
    if (recording) recordings.push(recording);
  }
  return recordings;
}

function toRecording(item: ItunesResult): CatalogRecording | undefined {
  if (item.wrapperType && item.wrapperType !== 'track') return undefined;
  if (item.kind && item.kind !== 'song') return undefined;
  if (typeof item.trackId !== 'number' || !item.trackName || !item.artistName) return undefined;

  return {
    id: `itunes:${item.trackId}`,
    provider: 'itunes',
    title: item.trackName,
    artist: item.artistName,
    album: item.collectionName || undefined,
    artworkUrl: safeAppleUrl(item.artworkUrl100 ?? item.artworkUrl60),
    durationMs: typeof item.trackTimeMillis === 'number' && item.trackTimeMillis > 0 ? item.trackTimeMillis : undefined,
    explicitness: toExplicitness(item.trackExplicitness),
    // Apple reports album-only or unavailable tracks with a missing or non-positive price.
    price: typeof item.trackPrice === 'number' && item.trackPrice > 0 ? item.trackPrice : undefined,
    currency: item.currency || undefined,
    listingUrl: itunesStoreUrl(item.trackViewUrl),
    releaseDate: item.releaseDate || undefined,
    genre: item.primaryGenreName || undefined,
  };
}

function toExplicitness(value: string | undefined): Explicitness {
  switch (value) {
    case 'explicit':
      return 'explicit';
    case 'cleaned':
      return 'clean';
    case 'notExplicit':
      return 'not_explicit';
    default:
      return 'unknown';
  }
}

/** Only accept https links on Apple-owned hosts; upgrade plain http. */
export function safeAppleUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
    if (!/(^|\.)(apple\.com|mzstatic\.com)$/.test(url.hostname)) return undefined;
    url.protocol = 'https:';
    return url.toString();
  } catch {
    return undefined;
  }
}

/**
 * A safe listing URL that opens in the iTunes Store. Apple's `trackViewUrl`
 * now points at Apple Music; its `app=itunes` link parameter makes Apple's
 * apps show the purchasable iTunes Store page instead.
 */
export function itunesStoreUrl(value: string | undefined): string | undefined {
  const safe = safeAppleUrl(value);
  if (!safe) return undefined;
  const url = new URL(safe);
  if (/(^|\.)apple\.com$/.test(url.hostname)) url.searchParams.set('app', 'itunes');
  return url.toString();
}

let jsonpCounter = 0;

/** Minimal JSONP loader using the Search API's documented `callback` parameter. */
export const loadJsonp: JsonpLoader = (url, timeoutMs) =>
  new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('JSONP needs a browser document'));
      return;
    }
    jsonpCounter += 1;
    const callbackName = `__cratebridgeJsonp${Date.now()}_${jsonpCounter}`;
    const registry = window as unknown as Record<string, unknown>;
    const script = document.createElement('script');
    const cleanup = () => {
      clearTimeout(timer);
      delete registry[callbackName];
      script.remove();
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('JSONP request timed out'));
    }, timeoutMs);
    registry[callbackName] = (data: unknown) => {
      cleanup();
      resolve(data);
    };
    script.onerror = () => {
      cleanup();
      reject(new Error('JSONP request failed'));
    };
    script.src = `${url}&callback=${callbackName}`;
    script.async = true;
    document.head.appendChild(script);
  });
