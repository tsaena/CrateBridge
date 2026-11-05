import { isRecord, readPlaylist, readPlaylistItems, type SpotifyPlaylist } from './import';

// Public application identifier; PKCE does not use a client secret.
export const SPOTIFY_CLIENT_ID = 'ebb1ccd2e7084ccfb72e24282618812b';
export const SPOTIFY_SCOPES = 'playlist-read-private playlist-read-collaborative';
export const SESSION_KEY = 'cratebridge:spotify:session';
export const OAUTH_KEY = 'cratebridge:spotify:oauth';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API = 'https://api.spotify.com/v1';
const MAX_PAGES = 200;

interface Session { accessToken: string; refreshToken: string; expiresAt: number }
interface Pending { verifier: string; state: string; redirectUri: string; createdAt: number; clientId: string }
interface Options {
  clientId?: string;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  fetchImpl?: typeof fetch;
  cryptoImpl?: Crypto;
  now?: () => number;
}

export class SpotifyError extends Error {
  constructor(message: string, public readonly status?: number) { super(message); }
}

export function spotifyRedirectUri(href: string): string {
  const url = new URL(href);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new SpotifyError('Open CrateBridge over HTTPS, or use http://127.0.0.1:5173/ for local Spotify sign-in.');
  }
  return `${url.origin}${url.pathname}`;
}

function browserStorage() {
  try { return window.sessionStorage; } catch { return undefined; }
}

export class SpotifyClient {
  readonly clientId: string;
  returnedFromLogin = false;
  loginError?: string;
  private session?: Session;
  private storage: Options['storage'];
  private fetchImpl: typeof fetch;
  private crypto: Crypto;
  private now: () => number;
  private refreshing?: Promise<Session>;
  private generation = 0;
  private blockedUntil = 0;

  constructor(options: Options = {}) {
    this.clientId = options.clientId ?? SPOTIFY_CLIENT_ID;
    this.storage = options.storage ?? browserStorage();
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
    this.crypto = options.cryptoImpl ?? globalThis.crypto;
    this.now = options.now ?? Date.now;
    try {
      const raw: unknown = JSON.parse(this.storage?.getItem(SESSION_KEY) ?? 'null');
      if (isRecord(raw) && typeof raw.accessToken === 'string' && raw.accessToken && typeof raw.refreshToken === 'string' && raw.refreshToken && typeof raw.expiresAt === 'number' && Number.isFinite(raw.expiresAt)) {
        this.session = { accessToken: raw.accessToken, refreshToken: raw.refreshToken, expiresAt: raw.expiresAt };
      }
    } catch { /* An unreadable connection can be replaced by signing in again. */ }
  }

  get connected() { return Boolean(this.session); }

  async authorizationUrl(href: string): Promise<string> {
    if (!this.storage) throw new SpotifyError('Allow session storage in this browser to connect Spotify.');
    const redirectUri = spotifyRedirectUri(href);
    const random = (bytes: number) => Array.from(this.crypto.getRandomValues(new Uint8Array(bytes)), (n) => n.toString(16).padStart(2, '0')).join('');
    const verifier = random(32);
    const state = random(16);
    const digest = await this.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const pending: Pending = { verifier, state, redirectUri, createdAt: this.now(), clientId: this.clientId };
    try { this.storage.setItem(OAUTH_KEY, JSON.stringify(pending)); }
    catch { throw new SpotifyError('Allow session storage in this browser to connect Spotify.'); }
    const params = new URLSearchParams({ client_id: this.clientId, response_type: 'code', redirect_uri: redirectUri, scope: SPOTIFY_SCOPES, state, code_challenge_method: 'S256', code_challenge: challenge });
    return `https://accounts.spotify.com/authorize?${params}`;
  }

  /** Called once at startup, outside React effects so StrictMode can't redeem a code twice. */
  async completeLogin(href: string, replaceUrl: (url: string) => void): Promise<void> {
    const url = new URL(href);
    if (!url.searchParams.has('code') && !url.searchParams.has('error')) return;
    this.returnedFromLogin = true;
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const denied = url.searchParams.has('error');
    for (const key of ['code', 'state', 'error', 'error_description']) url.searchParams.delete(key);
    // Remove credentials from the address bar before making a request or rendering links.
    replaceUrl(url.toString());
    try {
      const pending: unknown = JSON.parse(this.storage?.getItem(OAUTH_KEY) ?? 'null');
      this.storage?.removeItem(OAUTH_KEY);
      if (!isRecord(pending) || !state || pending.state !== state || typeof pending.verifier !== 'string' || !/^[a-f0-9]{64}$/.test(pending.verifier) || pending.clientId !== this.clientId || pending.redirectUri !== spotifyRedirectUri(href) || typeof pending.createdAt !== 'number' || this.now() - pending.createdAt > 600_000 || pending.createdAt > this.now()) {
        throw new SpotifyError('Spotify sign-in expired or could not be verified. Please connect again from this tab.');
      }
      if (denied) throw new SpotifyError('Spotify access was not granted. You can connect again, or use paste or CSV import.');
      if (!code) throw new SpotifyError('Spotify did not return a sign-in code. Please connect again.');
      const generation = this.generation;
      const session = await this.exchange({ grant_type: 'authorization_code', code, redirect_uri: pending.redirectUri as string, code_verifier: pending.verifier });
      if (generation === this.generation) this.saveSession(session);
    } catch (error) {
      this.loginError = error instanceof SpotifyError ? error.message : 'Could not complete Spotify sign-in. Please connect again.';
    }
  }

  disconnect() {
    this.generation += 1;
    this.session = undefined;
    this.refreshing = undefined;
    this.loginError = undefined;
    try { this.storage?.removeItem(SESSION_KEY); this.storage?.removeItem(OAUTH_KEY); } catch { /* Memory is cleared regardless. */ }
  }

  private saveSession(session: Session) {
    this.session = session;
    // If saving is blocked, the current page can still use the in-memory token.
    try { this.storage?.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* Sign in again after reload. */ }
  }

  private async request(url: string, init: RequestInit = {}): Promise<unknown> {
    const seconds = Math.ceil((this.blockedUntil - this.now()) / 1000);
    if (seconds > 0) throw new SpotifyError(`Spotify asked us to wait. Try again in ${seconds} seconds.`, 429);
    let response: Response;
    try {
      response = await this.fetchImpl(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) });
    } catch (error) {
      if (init.signal?.aborted) throw error;
      throw new SpotifyError('Could not reach Spotify. Check your connection and try again.');
    }
    if (response.status === 429) {
      const retry = Number(response.headers.get('Retry-After') ?? 30);
      const seconds = Number.isFinite(retry) && retry > 0 ? Math.ceil(retry) : 30;
      this.blockedUntil = this.now() + seconds * 1000;
      throw new SpotifyError(`Spotify asked us to wait. Try again in ${seconds} seconds.`, 429);
    }
    if (!response.ok) {
      const message = response.status === 403
        ? 'Spotify denied access. Check the app’s allowed users and Premium owner. Playlist contents are available only when you own or collaborate on the playlist; use CSV for other playlists.'
        : response.status === 404 ? 'That playlist is unavailable to this Spotify account.'
        : response.status === 401 ? 'Your Spotify session expired. Connect again.'
        : 'Spotify could not complete this request. Please try again.';
      throw new SpotifyError(message, response.status);
    }
    try { return await response.json(); } catch { throw new SpotifyError('Spotify returned unreadable data. Please try again.'); }
  }

  private async exchange(params: Record<string, string>, previousRefreshToken?: string): Promise<Session> {
    const result = await this.request(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...params, client_id: this.clientId }) });
    if (!isRecord(result) || typeof result.access_token !== 'string' || !result.access_token || typeof result.expires_in !== 'number' || !Number.isFinite(result.expires_in) || result.expires_in <= 0 || (typeof result.token_type !== 'string' || result.token_type.toLowerCase() !== 'bearer')) {
      throw new SpotifyError('Spotify sign-in returned an invalid session. Please connect again.');
    }
    const refreshToken = typeof result.refresh_token === 'string' && result.refresh_token ? result.refresh_token : previousRefreshToken;
    if (!refreshToken) throw new SpotifyError('Spotify did not return a refresh token. Please connect again.');
    return { accessToken: result.access_token, refreshToken, expiresAt: this.now() + result.expires_in * 1000 };
  }

  private async token(forceRefresh = false): Promise<string> {
    const session = this.session;
    if (!session) throw new SpotifyError('Connect Spotify to import a playlist.');
    if (!forceRefresh && session.expiresAt > this.now() + 30_000) return session.accessToken;
    if (!this.refreshing) {
      const generation = this.generation;
      this.refreshing = this.exchange({ grant_type: 'refresh_token', refresh_token: session.refreshToken }, session.refreshToken)
        .then((next) => {
          if (generation !== this.generation) throw new SpotifyError('Spotify was disconnected.');
          this.saveSession(next);
          return next;
        }).catch((error: unknown) => {
          if (error instanceof SpotifyError && (error.status === 400 || error.status === 401)) this.disconnect();
          throw error;
        }).finally(() => { if (generation === this.generation) this.refreshing = undefined; });
    }
    return (await this.refreshing).accessToken;
  }

  private async get(path: string, signal?: AbortSignal): Promise<unknown> {
    let token = await this.token();
    try { return await this.request(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` }, signal }); }
    catch (error) {
      if (!(error instanceof SpotifyError) || error.status !== 401 || signal?.aborted) throw error;
      token = await this.token(true);
      return this.request(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` }, signal });
    }
  }

  private async page(path: string, offset: number, signal?: AbortSignal) {
    const result = await this.get(`${path}?limit=50&offset=${offset}`, signal);
    if (!isRecord(result) || !Array.isArray(result.items) || result.items.length > 50) throw new SpotifyError('Spotify returned an invalid playlist page. Nothing was imported.');
    let nextOffset: number | undefined;
    if (result.next !== null && result.next !== undefined) {
      try {
        const next = new URL(String(result.next));
        const nextValue = next.searchParams.get('offset');
        const n = Number(nextValue);
        if (next.origin !== 'https://api.spotify.com' || next.pathname !== `/v1${path}` || next.username || next.password || !nextValue || !Number.isSafeInteger(n) || n <= offset) throw new Error();
        nextOffset = n;
      } catch { throw new SpotifyError('Spotify returned an invalid next page. Nothing was imported.'); }
    }
    return { items: result.items as unknown[], nextOffset };
  }

  async playlists(offset = 0, signal?: AbortSignal) {
    const page = await this.page('/me/playlists', offset, signal);
    return { playlists: page.items.map(readPlaylist).filter((p): p is SpotifyPlaylist => Boolean(p)), nextOffset: page.nextOffset };
  }

  async playlist(id: string, signal?: AbortSignal) {
    if (!/^[A-Za-z0-9]{22}$/.test(id)) throw new SpotifyError('Use a Spotify playlist link or playlist ID.');
    const playlist = readPlaylist(await this.get(`/playlists/${id}`, signal));
    if (!playlist) throw new SpotifyError('Spotify returned invalid playlist details.');
    return playlist;
  }

  async tracks(id: string, signal?: AbortSignal) {
    if (!/^[A-Za-z0-9]{22}$/.test(id)) throw new SpotifyError('Use a Spotify playlist link or playlist ID.');
    const items: unknown[] = [];
    let offset = 0;
    for (let n = 0; n < MAX_PAGES; n += 1) {
      const page = await this.page(`/playlists/${id}/items`, offset, signal);
      items.push(...page.items);
      if (page.nextOffset === undefined) return readPlaylistItems(items);
      offset = page.nextOffset;
    }
    throw new SpotifyError('This playlist exceeds the 10,000-item import limit. Split it into smaller playlists; nothing was imported.');
  }
}

export const spotify = new SpotifyClient();
