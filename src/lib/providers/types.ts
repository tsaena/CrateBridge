import type { CatalogRecording } from '../../types';

export interface CatalogQuery {
  term: string;
  /** ISO 3166-1 alpha-2 storefront code. */
  country: string;
  limit?: number;
}

/**
 * A retailer catalog that can be searched for purchasable recordings.
 * iTunes is the only implementation today; Beatport, Bandcamp, etc. would
 * implement the same interface.
 */
export interface CatalogProvider {
  id: CatalogRecording['provider'];
  name: string;
  search(query: CatalogQuery, signal?: AbortSignal): Promise<CatalogRecording[]>;
}

/**
 * How a catalog lookup failed. Each kind is something the app actually observed:
 * - `rate_limited`: HTTP 403 or 429.
 * - `server` / `bad_response`: another HTTP error, or a body that couldn't be read.
 * - `redirected`: the catalog answered with a redirect instead of results.
 * - `timeout`: no answer within the time limit.
 * - `network`: the request failed without a response (offline, blocked, or CORS).
 * - `no_response`: neither the request nor its script fallback got an answer; the cause is unknown.
 * - `internal`: an exception in CrateBridge itself.
 */
export type CatalogErrorKind =
  | 'rate_limited'
  | 'no_response'
  | 'network'
  | 'timeout'
  | 'redirected'
  | 'server'
  | 'bad_response'
  | 'internal'
  | 'aborted';

const FINAL_KINDS: readonly CatalogErrorKind[] = ['bad_response', 'redirected', 'internal', 'aborted'];

export class CatalogError extends Error {
  readonly kind: CatalogErrorKind;
  readonly status?: number;
  /** Short code for what the transport saw, e.g. `jsonp-script-error`. Never includes the query. */
  readonly detail?: string;

  constructor(kind: CatalogErrorKind, message: string, status?: number, detail?: string) {
    super(message);
    this.name = 'CatalogError';
    this.kind = kind;
    this.status = status;
    this.detail = detail;
  }

  get retryable(): boolean {
    return !FINAL_KINDS.includes(this.kind);
  }
}
