import { describe, expect, it, vi } from 'vitest';
import { buildSearchUrl, createItunesProvider, parseItunesResponse, safeAppleUrl } from './itunes';
import { CatalogError } from './types';
import { itunesResult, jsonResponse } from '../../test/fixtures';

const query = { term: 'The Weeknd Blinding Lights', country: 'us' };

describe('buildSearchUrl', () => {
  it('requests songs from the music media type in the chosen storefront', () => {
    const url = new URL(buildSearchUrl({ ...query, limit: 500 }));
    expect(url.origin + url.pathname).toBe('https://itunes.apple.com/search');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      term: 'The Weeknd Blinding Lights',
      country: 'US',
      media: 'music',
      entity: 'song',
      limit: '200',
    });
  });
});

describe('parseItunesResponse', () => {
  it('maps documented fields to catalog recordings', () => {
    const [recording] = parseItunesResponse({ resultCount: 1, results: [itunesResult({ trackId: 42, trackExplicitness: 'explicit' })] });
    expect(recording).toMatchObject({
      id: 'itunes:42',
      provider: 'itunes',
      title: 'Blinding Lights',
      artist: 'The Weeknd',
      album: 'After Hours',
      durationMs: 200_040,
      explicitness: 'explicit',
      price: 1.29,
      currency: 'USD',
      genre: 'R&B/Soul',
    });
    expect(recording?.listingUrl).toMatch(/^https:\/\/music\.apple\.com\//);
    // Opens the purchasable iTunes Store page rather than Apple Music.
    expect(new URL(recording!.listingUrl!).searchParams.get('app')).toBe('itunes');
  });

  it('maps clean and unknown explicitness', () => {
    const [clean, unknown] = parseItunesResponse({
      results: [itunesResult({ trackExplicitness: 'cleaned' }), itunesResult({ trackExplicitness: undefined })],
    });
    expect(clean?.explicitness).toBe('clean');
    expect(unknown?.explicitness).toBe('unknown');
  });

  it('returns an empty list for empty results', () => {
    expect(parseItunesResponse({ resultCount: 0, results: [] })).toEqual([]);
  });

  it('skips non-song results and results missing required fields', () => {
    const results = [
      itunesResult({ wrapperType: 'collection' }),
      itunesResult({ kind: 'music-video' }),
      itunesResult({ trackId: undefined }),
      itunesResult({ trackName: undefined }),
      itunesResult(),
    ];
    expect(parseItunesResponse({ results })).toHaveLength(1);
  });

  it('treats missing or non-positive prices as not individually purchasable', () => {
    const [albumOnly, missing] = parseItunesResponse({
      results: [itunesResult({ trackPrice: -1 }), itunesResult({ trackPrice: undefined })],
    });
    expect(albumOnly?.price).toBeUndefined();
    expect(missing?.price).toBeUndefined();
  });

  it('drops missing or untrusted store URLs and upgrades http to https', () => {
    const [missing, foreign, script, http] = parseItunesResponse({
      results: [
        itunesResult({ trackViewUrl: undefined }),
        itunesResult({ trackViewUrl: 'https://evil.example.com/album/1' }),
        itunesResult({ trackViewUrl: 'javascript:alert(1)' }),
        itunesResult({ trackViewUrl: 'http://itunes.apple.com/us/album/x?i=1', artworkUrl100: 'http://a1.mzstatic.com/x.jpg' }),
      ],
    });
    expect(missing?.listingUrl).toBeUndefined();
    expect(foreign?.listingUrl).toBeUndefined();
    expect(script?.listingUrl).toBeUndefined();
    expect(http?.listingUrl).toBe('https://itunes.apple.com/us/album/x?i=1&app=itunes');
    expect(http?.artworkUrl).toBe('https://a1.mzstatic.com/x.jpg');
    expect(safeAppleUrl('https://notapple.com.evil.io/x')).toBeUndefined();
  });

  it('rejects malformed payloads', () => {
    expect(() => parseItunesResponse(null)).toThrow(CatalogError);
    expect(() => parseItunesResponse({ results: 'nope' })).toThrow(CatalogError);
  });
});

describe('createItunesProvider', () => {
  it('returns parsed recordings on success', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ resultCount: 1, results: [itunesResult()] }));
    const provider = createItunesProvider({ fetchImpl, jsonp: null });
    await expect(provider.search(query)).resolves.toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining('https://itunes.apple.com/search?'), expect.anything());
  });

  it.each([403, 429])('reports HTTP %i as rate limiting', async (status) => {
    const provider = createItunesProvider({ fetchImpl: vi.fn().mockResolvedValue(new Response('', { status })), jsonp: null });
    await expect(provider.search(query)).rejects.toMatchObject({ kind: 'rate_limited', retryable: true });
  });

  it('reports server errors as retryable and other HTTP errors as final', async () => {
    const server = createItunesProvider({ fetchImpl: vi.fn().mockResolvedValue(new Response('', { status: 503 })), jsonp: null });
    await expect(server.search(query)).rejects.toMatchObject({ kind: 'server', retryable: true });
    const bad = createItunesProvider({ fetchImpl: vi.fn().mockResolvedValue(new Response('', { status: 400 })), jsonp: null });
    await expect(bad.search(query)).rejects.toMatchObject({ kind: 'bad_response', retryable: false });
  });

  it('reports unreadable JSON', async () => {
    const provider = createItunesProvider({ fetchImpl: vi.fn().mockResolvedValue(new Response('<html>', { status: 200 })), jsonp: null });
    await expect(provider.search(query)).rejects.toMatchObject({ kind: 'bad_response' });
  });

  it('reports network failures when no fallback is available', async () => {
    const provider = createItunesProvider({ fetchImpl: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')), jsonp: null });
    await expect(provider.search(query)).rejects.toMatchObject({ kind: 'network', retryable: true });
  });

  it('falls back to JSONP when fetch is blocked, then keeps using it', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const jsonp = vi.fn().mockResolvedValue({ results: [itunesResult()] });
    const provider = createItunesProvider({ fetchImpl, jsonp });
    await expect(provider.search(query)).resolves.toHaveLength(1);
    await expect(provider.search(query)).resolves.toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(jsonp).toHaveBeenCalledTimes(2);
  });

  it('treats a failed JSONP request as possible rate limiting, since its status is hidden', async () => {
    const provider = createItunesProvider({
      fetchImpl: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
      jsonp: vi.fn().mockRejectedValue(new Error('script error')),
    });
    await expect(provider.search(query)).rejects.toMatchObject({ kind: 'possibly_rate_limited', retryable: true });
  });

  it('reports cancellation without falling back', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    });
    const jsonp = vi.fn();
    const provider = createItunesProvider({ fetchImpl: fetchImpl as unknown as typeof fetch, jsonp });
    const pending = provider.search(query, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
    expect(jsonp).not.toHaveBeenCalled();
  });
});
