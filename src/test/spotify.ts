export const SPOTIFY_PLAYLIST_ID = '3cEYpjA9oz9GiPac4AsH4n';
export const SPOTIFY_TRACK_ID = '0VjIjW4GlUZAMYd2vXMi3b';
export const spotifyPlaylistFixture = {
  id: SPOTIFY_PLAYLIST_ID, name: 'Friday set', items: { total: 1 },
};
export const spotifyTrackFixture = {
  type: 'track', id: SPOTIFY_TRACK_ID, name: 'Blinding Lights',
  artists: [{ name: 'The Weeknd' }], album: { name: 'After Hours' },
  duration_ms: 200_040, external_ids: { isrc: 'USUG11904206' },
  explicit: false,
};
