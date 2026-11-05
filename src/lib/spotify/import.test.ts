import { describe, expect, it } from 'vitest';
import { readPlaylistItems, safeSpotifyTrackUrl, spotifyPlaylistId } from './import';
import { SPOTIFY_PLAYLIST_ID, SPOTIFY_TRACK_ID, spotifyTrackFixture } from '../../test/spotify';

describe('Spotify metadata import', () => {
  it('accepts playlist links, international links, URIs, and IDs but rejects other hosts and types', () => {
    for (const value of [SPOTIFY_PLAYLIST_ID, `spotify:playlist:${SPOTIFY_PLAYLIST_ID}`, `https://open.spotify.com/playlist/${SPOTIFY_PLAYLIST_ID}?si=abc`, `https://open.spotify.com/intl-es/playlist/${SPOTIFY_PLAYLIST_ID}`]) {
      expect(spotifyPlaylistId(value)).toBe(SPOTIFY_PLAYLIST_ID);
    }
    for (const value of ['javascript:alert(1)', `https://open.spotify.com.evil.test/playlist/${SPOTIFY_PLAYLIST_ID}`, `https://evil.test/${SPOTIFY_PLAYLIST_ID}`, `https://open.spotify.com/track/${SPOTIFY_TRACK_ID}`, 'https://spotify.link/short', 'invalid']) {
      expect(spotifyPlaylistId(value)).toBeUndefined();
    }
  });

  it('preserves version wording and metadata in both current and older API shapes, counting skipped items', () => {
    const track = { ...spotifyTrackFixture, name: 'Blinding Lights (Live)', artists: [{ name: 'The Weeknd' }, { name: 'Guest' }] };
    const result = readPlaylistItems([
      { item: track }, { track: spotifyTrackFixture },
      { item: null }, { item: { ...track, type: 'episode' } },
      { is_local: true, item: track }, { item: { ...track, is_local: true } },
      { item: { ...track, artists: [] } }, { item: { ...track, name: '' } },
      { item: null, track }, null,
    ]);
    expect(result.skipped).toBe(8);
    expect(result.drafts).toHaveLength(2);
    expect(result.drafts[0]).toEqual({
      title: 'Blinding Lights (Live)', artist: 'The Weeknd, Guest', album: 'After Hours',
      explicit: false,
      durationMs: 200_040, isrc: 'USUG11904206', spotifyUrl: `https://open.spotify.com/track/${SPOTIFY_TRACK_ID}`,
    });
  });

  it('allows only canonical Spotify track attribution links', () => {
    expect(safeSpotifyTrackUrl(`https://open.spotify.com/track/${SPOTIFY_TRACK_ID}?si=abc`)).toBe(`https://open.spotify.com/track/${SPOTIFY_TRACK_ID}`);
    for (const url of ['javascript:alert(1)', 'https://tracker.test/track/abc', `https://open.spotify.com/playlist/${SPOTIFY_PLAYLIST_ID}`]) {
      expect(safeSpotifyTrackUrl(url)).toBeUndefined();
    }
  });
});
