import { afterEach, describe, expect, it, vi } from 'vitest';
import { JsonpError, buildSearchUrl, createItunesProvider, loadJsonp, parseItunesResponse, safeAppleUrl } from './itunes';
import { CatalogError } from './types';
import { itunesResult, jsonResponse } from '../../test/fixtures';

const query = { term: 'The Weeknd Blinding Lights', country: 'us' };

describe('buildSearchUrl', () => {
  // Apple redirects `media=music` searches from iPhone and iPad browsers to the Music app (#4).
  it('requests songs in the chosen storefront without media=music', () => {
    const url = new URL(buildSearchUrl({ ...query, limit: 500 }));
    expect(url.origin + url.pathname).toBe('https://itunes.apple.com/search');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      term: 'The Weeknd Blinding Lights',
      country: 'US',
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

  it('flags various-artists compilations from collectionArtistName', () => {
    const [compilation, ownAlbum, artistCompilation] = parseItunesResponse({
      results: [
        itunesResult({ collectionName: 'Pop Music: The Modern Era 1976-1999', collectionArtistName: 'Various Artists' }),
        itunesResult({ collectionName: 'Thriller' }),
        itunesResult({ collectionName: 'Number Ones', collectionArtistName: 'Michael Jackson' }),
      ],
    });
    expect(compilation?.compilation).toBe(true);
    expect(ownAlbum?.compilation).toBeUndefined();
    // Only various-artists albums are flagged here; an artist's own hits album is detected by name in ranking.
    expect(artistCompilation?.compilation).toBeUndefined();
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

  it('falls back to JSONP when fetch is blocked, and switches to it once fetch keeps failing', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const jsonp = vi.fn().mockResolvedValue({ results: [itunesResult()] });
    const provider = createItunesProvider({ fetchImpl, jsonp });
    for (let i = 0; i < 3; i += 1) await expect(provider.search(query)).resolves.toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(jsonp).toHaveBeenCalledTimes(3);
  });

  it('keeps using fetch after a one-off failure', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse({ results: [itunesResult()] }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(jsonResponse({ results: [itunesResult()] }));
    const jsonp = vi.fn().mockResolvedValue({ results: [itunesResult()] });
    const provider = createItunesProvider({ fetchImpl, jsonp });
    for (let i = 0; i < 4; i += 1) await expect(provider.search(query)).resolves.toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(jsonp).toHaveBeenCalledTimes(2);
  });

  it('reports a redirect as a redirect, without retrying or falling back', async () => {
    // What a browser returns for a redirect when fetch is told not to follow it.
    const redirect = { type: 'opaqueredirect', status: 0, ok: false } as Response;
    const fetchImpl = vi.fn().mockResolvedValue(redirect);
    const jsonp = vi.fn();
    const provider = createItunesProvider({ fetchImpl, jsonp });
    await expect(provider.search(query)).rejects.toMatchObject({ kind: 'redirected', retryable: false });
    expect(fetchImpl).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ redirect: 'manual' }));
    expect(jsonp).not.toHaveBeenCalled();
  });

  it('reports a timeout as a timeout, without falling back', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    });
    const jsonp = vi.fn();
    const provider = createItunesProvider({ fetchImpl: fetchImpl as unknown as typeof fetch, jsonp, timeoutMs: 15_000 });
    const assertion = expect(provider.search(query)).rejects.toMatchObject({ kind: 'timeout', retryable: true });
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
    expect(jsonp).not.toHaveBeenCalled();
  });

  it('does not call it rate limiting when neither fetch nor JSONP gets an answer', async () => {
    const provider = createItunesProvider({
      fetchImpl: vi.fn().mockRejectedValue(new TypeError('Load failed')),
      jsonp: vi.fn().mockRejectedValue(new JsonpError('script-error')),
    });
    const error: unknown = await provider.search(query).catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: 'no_response', retryable: true, detail: 'fetch-network+jsonp-script-error' });
    expect((error as CatalogError).message).not.toMatch(/limit/i);
  });

  it('goes back to fetch when JSONP fails, so the retry shows the real status', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(new Response('', { status: 403 }));
    const jsonp = vi
      .fn()
      .mockResolvedValueOnce({ results: [itunesResult()] })
      .mockResolvedValueOnce({ results: [itunesResult()] })
      .mockRejectedValue(new JsonpError('script-error'));
    const provider = createItunesProvider({ fetchImpl, jsonp });
    await provider.search(query);
    await provider.search(query);
    // Now on JSONP only: its failure can't be told apart from a rate limit.
    await expect(provider.search(query)).rejects.toMatchObject({ kind: 'no_response', detail: 'jsonp-script-error' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await expect(provider.search(query)).rejects.toMatchObject({ kind: 'rate_limited', status: 403 });
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

describe('loadJsonp', () => {
  afterEach(() => vi.useRealTimers());

  const lastScript = () => document.head.querySelector<HTMLScriptElement>('script[src*="callback="]')!;

  it('returns the data passed to its callback', async () => {
    const pending = loadJsonp('https://itunes.apple.com/search?term=x', 1000);
    const script = lastScript();
    const callback = new URL(script.src).searchParams.get('callback')!;
    (window as unknown as Record<string, (data: unknown) => void>)[callback]!({ results: [] });
    await expect(pending).resolves.toEqual({ results: [] });
    expect(script.isConnected).toBe(false);
  });

  it('tells a script that failed to load from one that returned no data and one that timed out', async () => {
    vi.useFakeTimers();
    const failed = loadJsonp('https://itunes.apple.com/search?term=x', 1000);
    lastScript().dispatchEvent(new Event('error'));
    await expect(failed).rejects.toMatchObject({ code: 'script-error' });

    const silent = loadJsonp('https://itunes.apple.com/search?term=x', 1000);
    lastScript().dispatchEvent(new Event('load'));
    await expect(silent).rejects.toMatchObject({ code: 'no-callback' });

    const slow = loadJsonp('https://itunes.apple.com/search?term=x', 1000);
    const assertion = expect(slow).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });
});
