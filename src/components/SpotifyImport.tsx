import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { TrackDraft } from '../types';
import { spotify, type SpotifyClient } from '../lib/spotify/client';
import { spotifyPlaylistId, type SpotifyPlaylist } from '../lib/spotify/import';
import { SpotifyLink, SpotifyMark } from './SpotifyLink';

interface Props {
  onImport: (drafts: TrackDraft[], playlistName?: string) => void;
  client?: SpotifyClient;
}

export function SpotifyImport({ onImport, client = spotify }: Props) {
  const [connected, setConnected] = useState(client.connected);
  const [error, setError] = useState(client.loginError);
  const [busy, setBusy] = useState(false);
  const [playlists, setPlaylists] = useState<SpotifyPlaylist[]>([]);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [nextOffset, setNextOffset] = useState<number>();
  const [link, setLink] = useState('');
  const [preview, setPreview] = useState<{ playlist: SpotifyPlaylist; drafts: TrackDraft[]; skipped: number }>();
  const [createNew, setCreateNew] = useState(true);
  const running = useRef<AbortController | undefined>(undefined);

  useEffect(() => () => running.current?.abort(), []);

  const run = async (task: (signal: AbortSignal) => Promise<void>) => {
    running.current?.abort();
    const controller = new AbortController();
    running.current = controller;
    setBusy(true);
    setError(undefined);
    try { await task(controller.signal); }
    catch (error) {
      if (!controller.signal.aborted) {
        setError(error instanceof Error ? error.message : 'Could not load Spotify. Please try again.');
        setConnected(client.connected);
      }
    } finally { if (!controller.signal.aborted) setBusy(false); }
  };

  const loadPlaylists = () => void run(async (signal) => {
    setPreview(undefined);
    const page = await client.playlists(0, signal);
    if (!signal.aborted) { setPlaylists(page.playlists); setNextOffset(page.nextOffset); setLibraryLoaded(true); }
  });

  const loadPlaylist = (id: string) => void run(async (signal) => {
    setPreview(undefined);
    const playlist = await client.playlist(id, signal);
    const result = await client.tracks(id, signal);
    if (!signal.aborted) setPreview({ playlist, ...result });
  });

  const submitLink = (event: FormEvent) => {
    event.preventDefault();
    const id = spotifyPlaylistId(link);
    if (!id) { setError('Paste a full open.spotify.com/playlist/… link, Spotify playlist URI, or playlist ID.'); return; }
    loadPlaylist(id);
  };

  return (
    <div className="grid gap-4">
      <p className="text-sm text-ink-300">
        Import track names and metadata from a playlist you own or collaborate on. Spotify never supplies music files here.
      </p>
      <p className="text-xs leading-5 text-ink-400">
        This Spotify app is in development mode: its owner needs Premium and users must be allowed by the app owner.
        Other people’s and Spotify’s editorial playlists may be unavailable; paste or CSV import still works for those.
      </p>

      {error && <p role="alert" className="text-sm text-nomatch-400">{error}</p>}

      {!connected ? (
        <div>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void run(async () => {
            const url = await client.authorizationUrl(window.location.href);
            window.location.assign(url);
          })}>
            <SpotifyMark />Connect Spotify
          </button>
          <p className="mt-2 text-xs text-ink-400">You’ll sign in on Spotify. Access is read-only, and disconnecting keeps your imported playlists.</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1.5 text-sm text-ink-200"><SpotifyMark />Spotify connected</span>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={loadPlaylists}>Load my playlists</button>
            <button type="button" className="btn btn-ghost" onClick={() => {
              running.current?.abort(); client.disconnect(); setConnected(false); setBusy(false);
              setPlaylists([]); setPreview(undefined); setError(undefined); setNextOffset(undefined); setLibraryLoaded(false);
            }}>Disconnect Spotify</button>
          </div>

          <form onSubmit={submitLink} className="flex flex-wrap items-end gap-2">
            <label className="grid min-w-0 flex-1 gap-1 text-xs text-ink-300">
              Spotify playlist link
              <input className="field" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://open.spotify.com/playlist/…" required />
            </label>
            <button type="submit" className="btn btn-secondary" disabled={busy || !link.trim()}>Preview playlist</button>
          </form>

          {busy && <p role="status" className="text-sm text-ink-300">Loading from Spotify…</p>}
          {libraryLoaded && !busy && !playlists.length && !preview && <p className="text-sm text-ink-400">Spotify returned no playlists. You can paste a playlist link above, or use CSV import.</p>}

          {playlists.length > 0 && !preview && (
            <div className="grid gap-2">
              <ul aria-label="Spotify playlists" className="grid max-h-64 gap-2 overflow-y-auto">
                {playlists.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ink-700 p-3">
                    <SpotifyLink href={p.url}>{p.name}{p.total !== undefined ? ` (${p.total} items)` : ''}</SpotifyLink>
                    <button type="button" className="btn btn-secondary" disabled={busy} aria-label={`Preview ${p.name}`} onClick={() => loadPlaylist(p.id)}>Preview</button>
                  </li>
                ))}
              </ul>
              {nextOffset !== undefined && <button type="button" className="btn btn-ghost justify-self-start" disabled={busy} onClick={() => void run(async (signal) => {
                const page = await client.playlists(nextOffset, signal);
                if (!signal.aborted) {
                  setPlaylists((existing) => [...existing, ...page.playlists.filter((p) => !existing.some((e) => e.id === p.id))]);
                  setNextOffset(page.nextOffset);
                }
              })}>Load more playlists</button>}
            </div>
          )}

          {preview && (
            <section aria-label="Spotify import preview" className="grid gap-3 rounded-xl border border-ink-700 bg-ink-900/60 p-4">
              <SpotifyLink href={preview.playlist.url}>{preview.playlist.name}</SpotifyLink>
              <p className="text-sm text-ink-200">{preview.drafts.length} tracks ready to import.</p>
              {preview.skipped > 0 && <p className="text-xs text-review-300">Skipped {preview.skipped} local, unavailable, non-music, or incomplete items.</p>}
              <ol aria-label="Spotify track preview" className="grid max-h-64 gap-2 overflow-y-auto">
                {preview.drafts.slice(0, 10).map((draft, i) => (
                  <li key={i}><SpotifyLink href={draft.spotifyUrl!}>{draft.artist} – {draft.title}{draft.explicit === true && ' · Explicit'}</SpotifyLink></li>
                ))}
              </ol>
              {preview.drafts.length > 10 && <p className="text-xs text-ink-400">Showing the first 10 tracks; all {preview.drafts.length} will be imported.</p>}
              <label className="flex items-center gap-2 text-sm text-ink-300">
                <input type="checkbox" checked={createNew} onChange={(e) => setCreateNew(e.target.checked)} className="size-4 accent-cue-500" />
                Create a new playlist named “{preview.playlist.name}”
              </label>
              {!createNew && <p className="text-xs text-ink-400">Tracks will be added to the current CrateBridge playlist. Existing tracks are kept.</p>}
              <button type="button" className="btn btn-primary justify-self-start" disabled={busy || !preview.drafts.length} onClick={() => {
                onImport(preview.drafts, createNew ? preview.playlist.name : undefined);
                setPreview(undefined);
              }}>Import {preview.drafts.length} {preview.drafts.length === 1 ? 'track' : 'tracks'}</button>
            </section>
          )}
        </>
      )}
    </div>
  );
}
