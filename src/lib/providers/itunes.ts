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
  /** Present when the album artist differs from the track's, e.g. "Various Artists". */
  collectionArtistName?: string;
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

/** Why a JSONP request produced no data. A script request never exposes its HTTP status. */
export type JsonpFailure = 'script-error' | 'timeout' | 'no-callback' | 'unavailable';

export class JsonpError extends Error {
  readonly code: JsonpFailure;

  constructor(code: JsonpFailure) {
    super(`JSONP request failed (${code})`);
    this.name = 'JsonpError';
    this.code = code;
  }
}

export interface ItunesProviderOptions {
  fetchImpl?: typeof fetch;
  /** Fallback transport used when `fetch` is blocked (e.g. by CORS). Pass `null` to disable. */
  jsonp?: JsonpLoader | null;
  timeoutMs?: number;
}

/**
 * `media=music` is deliberately not sent. For iPhone and iPad browsers Apple
 * answers a `media=music` search with a redirect to the Music app
 * (`musics://…`) instead of results, which fails every lookup there (#4).
 * `entity=song` alone returns the same songs to every browser.
 */
export function buildSearchUrl({ term, country, limit = 25 }: CatalogQuery): string {
  const params = new URLSearchParams({
    term,
    country: country.toUpperCase(),
    entity: 'song',
    limit: String(Math.min(Math.max(limit, 1), 200)),
  });
  return `${ITUNES_SEARCH_ENDPOINT}?${params.toString()}`;
}

/** Consecutive fetch failures rescued by JSONP before the session switches to JSONP. */
export const JSONP_SWITCH_AFTER = 2;

export function createItunesProvider(options: ItunesProviderOptions = {}): CatalogProvider {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const jsonp = options.jsonp === undefined ? loadJsonp : options.jsonp;
  // Apple's responses, including 403 rate limits, carry CORS headers, so fetch
  // normally works and shows real status codes. Only switch to JSONP after
  // fetch has failed repeatedly while JSONP worked, so one network blip
  // doesn't hide status codes, and switch back as soon as JSONP fails.
  let jsonpRescues = 0;
  let preferJsonp = false;

  async function viaFetch(url: string, signal?: AbortSignal): Promise<unknown> {
    const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new DOMException('Timed out', 'TimeoutError'));
    }, timeoutMs);
    const onAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      // The search never needs a redirect. Not following one lets a redirect be
      // reported as what it is; a followed redirect to an app scheme would look
      // like a network failure.
      const response = await fetchImpl(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
        redirect: 'manual',
      });
      if (response.type === 'opaqueredirect' || (response.status >= 300 && response.status < 400)) {
        throw new CatalogError('redirected', 'Apple redirected this lookup instead of answering it.', undefined, 'fetch-redirect');
      }
      if (response.status === 403 || response.status === 429) {
        throw new CatalogError('rate_limited', `Apple is limiting requests right now (HTTP ${response.status}).`, response.status);
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
      if (timedOut) {
        const seconds = Math.round(timeoutMs / 1000);
        throw new CatalogError('timeout', `Apple’s catalog didn’t answer within ${seconds} seconds.`, undefined, 'fetch-timeout');
      }
      if (error instanceof SyntaxError) throw new CatalogError('bad_response', 'Apple returned unreadable data.');
      throw new CatalogError('network', 'Couldn’t reach Apple’s catalog.', undefined, 'fetch-network');
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
        try {
          payload = await viaJsonp(jsonp, url, timeoutMs);
        } catch (error) {
          // A script request hides its status, so go back to fetch: the retry then shows what Apple actually answers.
          preferJsonp = false;
          jsonpRescues = 0;
          throw error;
        }
      } else {
        try {
          payload = await viaFetch(url, signal);
          jsonpRescues = 0;
        } catch (error) {
          // Only a fetch that failed without any response can be a CORS block, which a script request gets around.
          // A status, a redirect or a timeout would be the same for a script.
          if (!(error instanceof CatalogError) || error.kind !== 'network' || !jsonp || signal?.aborted) throw error;
          payload = await viaJsonp(jsonp, url, timeoutMs, 'fetch-network');
          jsonpRescues += 1;
          if (jsonpRescues >= JSONP_SWITCH_AFTER) preferJsonp = true;
        }
      }
      if (signal?.aborted) throw new CatalogError('aborted', 'Search cancelled.');
      return parseItunesResponse(payload);
    },
  };
}

const JSONP_FAILURE_TEXT: Record<JsonpFailure, string> = {
  'script-error': 'failed to load',
  timeout: 'timed out',
  'no-callback': 'loaded without returning data',
  unavailable: 'couldn’t run',
};

async function viaJsonp(jsonp: JsonpLoader, url: string, timeoutMs: number, fetchDetail?: string): Promise<unknown> {
  try {
    return await jsonp(url, timeoutMs);
  } catch (error) {
    // Nothing here says why. In particular it is not evidence of rate limiting:
    // Apple's 403 responses carry CORS headers, so fetch reports those itself.
    const code: JsonpFailure = error instanceof JsonpError ? error.code : 'script-error';
    const script = `the ${fetchDetail ? 'fallback ' : ''}script request ${JSONP_FAILURE_TEXT[code]}`;
    throw new CatalogError(
      'no_response',
      fetchDetail
        ? `Couldn’t reach Apple’s catalog: the request got no response, and ${script}.`
        : `Couldn’t reach Apple’s catalog: ${script}.`,
      undefined,
      [fetchDetail, `jsonp-${code}`].filter(Boolean).join('+'),
    );
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
    compilation: /^various artists$/i.test(item.collectionArtistName ?? '') || undefined,
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
      reject(new JsonpError('unavailable'));
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
    const fail = (code: JsonpFailure) => {
      cleanup();
      reject(new JsonpError(code));
    };
    const timer = setTimeout(() => fail('timeout'), timeoutMs);
    registry[callbackName] = (data: unknown) => {
      cleanup();
      resolve(data);
    };
    script.onerror = () => fail('script-error');
    // A script runs before its load event, so by now the callback has been called if it was going to be.
    script.onload = () => {
      if (callbackName in registry) fail('no-callback');
    };
    script.src = `${url}&callback=${callbackName}`;
    script.async = true;
    document.head.appendChild(script);
  });
