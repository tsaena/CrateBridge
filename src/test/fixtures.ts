import type { CatalogRecording } from '../types';
import type { ItunesResult } from '../lib/providers/itunes';

let nextId = 1000;

export function recording(overrides: Partial<CatalogRecording> = {}): CatalogRecording {
  nextId += 1;
  return {
    id: `itunes:${nextId}`,
    provider: 'itunes',
    title: 'Blinding Lights',
    artist: 'The Weeknd',
    album: 'After Hours',
    durationMs: 200_040,
    explicitness: 'not_explicit',
    price: 1.29,
    currency: 'USD',
    listingUrl: `https://music.apple.com/us/album/blinding-lights/1499378108?i=${nextId}&uo=4`,
    releaseDate: '2019-11-29T08:00:00Z',
    ...overrides,
  };
}

export function itunesResult(overrides: Partial<ItunesResult> = {}): ItunesResult {
  nextId += 1;
  return {
    wrapperType: 'track',
    kind: 'song',
    trackId: nextId,
    trackName: 'Blinding Lights',
    trackCensoredName: 'Blinding Lights',
    artistName: 'The Weeknd',
    collectionName: 'After Hours',
    artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Music/100x100bb.jpg',
    trackTimeMillis: 200_040,
    trackExplicitness: 'notExplicit',
    trackPrice: 1.29,
    currency: 'USD',
    trackViewUrl: `https://music.apple.com/us/album/blinding-lights/1499378108?i=${nextId}&uo=4`,
    releaseDate: '2019-11-29T08:00:00Z',
    primaryGenreName: 'R&B/Soul',
    ...overrides,
  };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
