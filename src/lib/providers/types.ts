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

export type CatalogErrorKind = 'rate_limited' | 'possibly_rate_limited' | 'network' | 'server' | 'bad_response' | 'aborted';

export class CatalogError extends Error {
  readonly kind: CatalogErrorKind;
  readonly status?: number;

  constructor(kind: CatalogErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'CatalogError';
    this.kind = kind;
    this.status = status;
  }

  get retryable(): boolean {
    return this.kind !== 'bad_response' && this.kind !== 'aborted';
  }
}
