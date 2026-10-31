import type { CatalogRecording } from '../../types';
import { CatalogError, type CatalogProvider, type CatalogQuery } from '../providers/types';
import { RateLimiter, type PauseReason } from './rateLimiter';

export interface SearchServiceOptions {
  /** Spacing between requests. Apple documents roughly 20 calls per minute. */
  minIntervalMs?: number;
  maxRetries?: number;
  /** Base wait after a rate-limit response; doubles on each repeat. */
  rateLimitBackoffMs?: number;
  /** Base wait after a network or server error; doubles on each retry. */
  retryBackoffMs?: number;
  cacheSize?: number;
  now?: () => number;
}

// Apple documents roughly 20 calls per minute; 15 leaves headroom for other
// clients on the same network, such as a phone on the same Wi-Fi.
export const DEFAULT_MIN_INTERVAL_MS = 4_000;

/**
 * Wraps a catalog provider with pacing, retries, an in-memory cache, and
 * de-duplication of identical in-flight queries.
 */
export class CatalogSearchService {
  readonly limiter: RateLimiter;
  private readonly provider: CatalogProvider;
  private readonly cache = new Map<string, CatalogRecording[]>();
  private readonly inflight = new Map<string, Promise<CatalogRecording[]>>();
  private readonly maxRetries: number;
  private readonly rateLimitBackoffMs: number;
  private readonly retryBackoffMs: number;
  private readonly cacheSize: number;
  private readonly now: () => number;

  constructor(provider: CatalogProvider, options: SearchServiceOptions = {}) {
    this.provider = provider;
    this.now = options.now ?? Date.now;
    this.limiter = new RateLimiter({ minIntervalMs: options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS, now: this.now });
    this.maxRetries = options.maxRetries ?? 2;
    this.rateLimitBackoffMs = options.rateLimitBackoffMs ?? 30_000;
    this.retryBackoffMs = options.retryBackoffMs ?? 2_000;
    this.cacheSize = options.cacheSize ?? 500;
  }

  static cacheKey(query: CatalogQuery): string {
    return `${query.country.toUpperCase()}|${query.limit ?? 25}|${query.term.trim().toLowerCase()}`;
  }

  cached(query: CatalogQuery): CatalogRecording[] | undefined {
    return this.cache.get(CatalogSearchService.cacheKey(query));
  }

  search(query: CatalogQuery, options: { signal?: AbortSignal; priority?: boolean } = {}): Promise<CatalogRecording[]> {
    const key = CatalogSearchService.cacheKey(query);
    const hit = this.cache.get(key);
    if (hit) return Promise.resolve(hit);
    // Share in-flight work only when the caller can't cancel it out from under others.
    const pending = this.inflight.get(key);
    if (pending && !options.signal) return pending;

    const promise = this.attempt(query, options, 0).then((results) => {
      this.remember(key, results);
      return results;
    });
    if (!options.signal) {
      this.inflight.set(key, promise);
      void promise.catch(() => undefined).finally(() => this.inflight.delete(key));
    }
    return promise;
  }

  private async attempt(
    query: CatalogQuery,
    options: { signal?: AbortSignal; priority?: boolean },
    attempt: number,
  ): Promise<CatalogRecording[]> {
    try {
      return await this.limiter.schedule(() => this.provider.search(query, options.signal), options);
    } catch (error) {
      const catalogError =
        error instanceof CatalogError ? error : new CatalogError('network', 'Couldn’t reach the catalog.');
      if (!catalogError.retryable || attempt >= this.maxRetries || options.signal?.aborted) throw catalogError;
      const limited = catalogError.kind === 'rate_limited' || catalogError.kind === 'possibly_rate_limited';
      const wait = (limited ? this.rateLimitBackoffMs : this.retryBackoffMs) * 2 ** attempt;
      // Rate limiting affects every request, so pause the whole queue rather than just this one.
      this.limiter.pauseUntil(this.now() + wait, limited ? catalogError.kind as PauseReason : 'retry');
      return this.attempt(query, { ...options, priority: true }, attempt + 1);
    }
  }

  private remember(key: string, results: CatalogRecording[]): void {
    this.cache.set(key, results);
    if (this.cache.size > this.cacheSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
  }
}
