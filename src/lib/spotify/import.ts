import type { TrackDraft } from '../../types';

const ID = /^[A-Za-z0-9]{22}$/;
export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown) => typeof v === 'string' ? v.trim() : '';

/** Accept only full playlist URLs, Spotify URIs, or IDs; never fetch user URLs. */
export function spotifyPlaylistId(value: string): string | undefined {
  const input = value.trim();
  if (ID.test(input)) return input;
  if (input.startsWith('spotify:playlist:')) {
    const id = input.slice('spotify:playlist:'.length);
    return ID.test(id) ? id : undefined;
  }
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.hostname !== 'open.spotify.com' || url.port || url.username || url.password) return;
    const id = /^\/(?:intl-[a-z]{2}\/)?playlist\/([A-Za-z0-9]{22})\/?$/.exec(url.pathname)?.[1];
    return id;
  } catch { return; }
}

export function safeSpotifyTrackUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  const match = /^https:\/\/open\.spotify\.com\/track\/([A-Za-z0-9]{22})(?:\?[^#]*)?$/.exec(value);
  return match ? `https://open.spotify.com/track/${match[1]}` : undefined;
}

export interface SpotifyPlaylist {
  id: string;
  name: string;
  url: string;
  total?: number;
}

export function readPlaylist(value: unknown): SpotifyPlaylist | undefined {
  if (!isRecord(value) || !ID.test(text(value.id)) || !text(value.name)) return;
  const items = isRecord(value.items) ? value.items : isRecord(value.tracks) ? value.tracks : undefined;
  return {
    id: text(value.id), name: text(value.name), url: `https://open.spotify.com/playlist/${text(value.id)}`,
    total: items && typeof items.total === 'number' && Number.isSafeInteger(items.total) && items.total >= 0 ? items.total : undefined,
  };
}

/** Maps metadata only. Audio, images, and arbitrary API URLs are never retained. */
export function readPlaylistItems(items: unknown[]): { drafts: TrackDraft[]; skipped: number } {
  const drafts: TrackDraft[] = [];
  for (const entry of items) {
    if (!isRecord(entry) || entry.is_local === true) continue;
    // `item` is the 2026 shape; `track` supports older extended-access apps.
    const item = 'item' in entry ? entry.item : entry.track;
    if (!isRecord(item) || item.type !== 'track' || item.is_local === true) continue;
    const title = text(item.name);
    const artists = Array.isArray(item.artists) ? item.artists.filter(isRecord).map((a) => text(a.name)).filter(Boolean) : [];
    if (!title || !artists.length || !ID.test(text(item.id))) continue;
    const album = isRecord(item.album) ? text(item.album.name) : '';
    const isrc = isRecord(item.external_ids) ? text(item.external_ids.isrc) : '';
    drafts.push({
      title, artist: artists.join(', '), album: album || undefined,
      explicit: typeof item.explicit === 'boolean' ? item.explicit : undefined,
      durationMs: typeof item.duration_ms === 'number' && Number.isFinite(item.duration_ms) && item.duration_ms > 0 ? item.duration_ms : undefined,
      isrc: isrc || undefined,
      spotifyUrl: `https://open.spotify.com/track/${text(item.id)}`,
    });
  }
  return { drafts, skipped: items.length - drafts.length };
}
