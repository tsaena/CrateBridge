import { webcrypto } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { OAUTH_KEY, SESSION_KEY, SPOTIFY_CLIENT_ID, SpotifyClient, spotifyRedirectUri } from './client';
import { SPOTIFY_PLAYLIST_ID, spotifyTrackFixture } from '../../test/spotify';
import { jsonResponse } from '../../test/fixtures';

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); } };
}
const now = 1_000_000;
const callback = 'https://tsaena.github.io/CrateBridge/';
const tokens = { access_token: 'access', refresh_token: 'refresh', expires_in: 3600, token_type: 'Bearer' };
function setup(expired = false) {
  const storage = memoryStorage();
  storage.setItem(SESSION_KEY, JSON.stringify({ accessToken: 'old-access', refreshToken: 'refresh', expiresAt: expired ? 0 : now + 3600_000 }));
  const fetchImpl = vi.fn<typeof fetch>();
  const client = new SpotifyClient({ storage, fetchImpl, now: () => now, cryptoImpl: webcrypto as unknown as Crypto });
  return { storage, fetchImpl, client };
}

describe('Spotify PKCE', () => {
  it('binds authorization to state and redirect URI, exchanges without a secret, and scrubs the callback', async () => {
    const { client, storage, fetchImpl } = setup();
    const authorization = new URL(await client.authorizationUrl(callback));
    expect(authorization.origin).toBe('https://accounts.spotify.com');
    expect(authorization.searchParams.get('client_id')).toBe(SPOTIFY_CLIENT_ID);
    expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorization.searchParams.get('code_challenge')).toMatch(/^[\w-]{43}$/);
    expect(authorization.searchParams.get('scope')).toBe('playlist-read-private playlist-read-collaborative');
    const pending = JSON.parse(storage.getItem(OAUTH_KEY)!);
    fetchImpl.mockResolvedValue(jsonResponse(tokens));
    const replace = vi.fn();
    await client.completeLogin(`${callback}?code=code&state=${pending.state}`, replace);
    expect(replace).toHaveBeenCalledWith(callback);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const body = fetchImpl.mock.calls[0]![1]!.body as URLSearchParams;
    expect(Object.fromEntries(body.entries())).toEqual({ client_id: SPOTIFY_CLIENT_ID, grant_type: 'authorization_code', redirect_uri: callback, code: 'code', code_verifier: pending.verifier });
    expect(storage.getItem(OAUTH_KEY)).toBeNull();
    expect(JSON.parse(storage.getItem(SESSION_KEY)!)).toMatchObject({ accessToken: 'access', refreshToken: 'refresh' });
    expect(client.loginError).toBeUndefined();
  });

  it.each(['wrong state', 'expired', 'other path', 'denied'])('rejects %s without making a token request', async (kind) => {
    const { client, storage, fetchImpl } = setup();
    await client.authorizationUrl(callback);
    const pending = JSON.parse(storage.getItem(OAUTH_KEY)!);
    if (kind === 'expired') storage.setItem(OAUTH_KEY, JSON.stringify({ ...pending, createdAt: now - 600_001 }));
    const href = `${kind === 'other path' ? 'https://tsaena.github.io/other/' : callback}?${kind === 'denied' ? 'error=access_denied' : 'code=code'}&state=${kind === 'wrong state' ? 'wrong' : pending.state}`;
    const replace = vi.fn();
    await client.completeLogin(href, replace);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(client.loginError).toBeTruthy();
    expect(replace.mock.calls[0]![0]).not.toMatch(/code=|state=|error=/);
    expect(storage.getItem(OAUTH_KEY)).toBeNull();
  });

  it('requires HTTPS or explicit loopback redirects', () => {
    expect(spotifyRedirectUri(`${callback}?code=abc`)).toBe(callback);
    expect(spotifyRedirectUri('http://127.0.0.1:5173/')).toBe('http://127.0.0.1:5173/');
    expect(() => spotifyRedirectUri('http://localhost:5173/')).toThrow(/HTTPS/);
    expect(() => spotifyRedirectUri('http://192.168.1.2:5173/')).toThrow(/HTTPS/);
  });
});

describe('Spotify API', () => {
  it('refreshes an expired token once for concurrent reads and retains an unrotated refresh token', async () => {
    const { client, storage, fetchImpl } = setup(true);
    fetchImpl.mockImplementation(async (url) => String(url).includes('/api/token')
      ? jsonResponse({ access_token: 'new-access', expires_in: 3600, token_type: 'Bearer' })
      : jsonResponse({ items: [], next: null }));
    await Promise.all([client.playlists(), client.playlists()]);
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes('/api/token'))).toHaveLength(1);
    expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes('/v1/'))[0]![1]!.headers).toEqual({ Authorization: 'Bearer new-access' });
    expect(JSON.parse(storage.getItem(SESSION_KEY)!)).toMatchObject({ refreshToken: 'refresh' });
  });

  it('refreshes once on 401 and retries the request', async () => {
    const { client, fetchImpl } = setup();
    fetchImpl.mockResolvedValueOnce(jsonResponse({}, 401)).mockResolvedValueOnce(jsonResponse(tokens)).mockResolvedValueOnce(jsonResponse({ items: [], next: null }));
    await expect(client.playlists()).resolves.toMatchObject({ playlists: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('loads every playlist item page sequentially using the current items endpoint', async () => {
    const { client, fetchImpl } = setup();
    fetchImpl.mockResolvedValueOnce(jsonResponse({ items: [{ item: spotifyTrackFixture }], next: `https://api.spotify.com/v1/playlists/${SPOTIFY_PLAYLIST_ID}/items?offset=50&limit=50` }))
      .mockResolvedValueOnce(jsonResponse({ items: [{ item: { ...spotifyTrackFixture, name: 'Second' } }, { item: null }], next: null }));
    const result = await client.tracks(SPOTIFY_PLAYLIST_ID);
    expect(result.drafts.map((d) => d.title)).toEqual(['Blinding Lights', 'Second']);
    expect(result.skipped).toBe(1);
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([
      `https://api.spotify.com/v1/playlists/${SPOTIFY_PLAYLIST_ID}/items?limit=50&offset=0`,
      `https://api.spotify.com/v1/playlists/${SPOTIFY_PLAYLIST_ID}/items?limit=50&offset=50`,
    ]);
  });

  it.each(['https://evil.test/?offset=50', 'https://api.spotify.com/v1/me/playlists?offset=50', `https://api.spotify.com/v1/playlists/${SPOTIFY_PLAYLIST_ID}/items?offset=0`])('rejects unsafe or looping pagination: %s', async (next) => {
    const { client, fetchImpl } = setup();
    fetchImpl.mockResolvedValue(jsonResponse({ items: [{ item: spotifyTrackFixture }], next }));
    await expect(client.tracks(SPOTIFY_PLAYLIST_ID)).rejects.toThrow(/invalid next page/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('fails the entire import when a later page is forbidden instead of returning partial tracks', async () => {
    const { client, fetchImpl } = setup();
    fetchImpl.mockResolvedValueOnce(jsonResponse({ items: [{ item: spotifyTrackFixture }], next: `https://api.spotify.com/v1/playlists/${SPOTIFY_PLAYLIST_ID}/items?offset=50` }))
      .mockResolvedValueOnce(jsonResponse({}, 403));
    await expect(client.tracks(SPOTIFY_PLAYLIST_ID)).rejects.toThrow(/own or collaborate/);
  });

  it('honors Retry-After across operations without automatically issuing more requests', async () => {
    const { client, fetchImpl } = setup();
    fetchImpl.mockResolvedValue(new Response('{}', { status: 429, headers: { 'Retry-After': '90' } }));
    await expect(client.playlists()).rejects.toThrow(/90 seconds/);
    await expect(client.tracks(SPOTIFY_PLAYLIST_ID)).rejects.toThrow(/90 seconds/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('does not restore the connection if disconnected during refresh', async () => {
    const { client, storage, fetchImpl } = setup(true);
    let resolve!: (response: Response) => void;
    fetchImpl.mockReturnValue(new Promise((done) => { resolve = done; }));
    const request = client.playlists();
    client.disconnect();
    resolve(jsonResponse(tokens));
    await expect(request).rejects.toThrow(/disconnected/);
    expect(client.connected).toBe(false);
    expect(storage.getItem(SESSION_KEY)).toBeNull();
  });
});
