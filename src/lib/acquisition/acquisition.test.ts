import { describe, expect, it } from 'vitest';
import { ACQUISITION_PROVIDERS, orderedPools, providerById } from './providers';
import { CATALOG_EVIDENCE_TTL_MS, evidenceFor, openedText } from './evidence';
import { draftToTrack, workspaceReducer } from '../../state/workspace';
import { rankCandidates } from '../matching/rank';
import { recording } from '../../test/fixtures';
import type { Track } from '../../types';

const NOW = 1_800_000_000_000;

function track(overrides: Partial<Track> = {}): Track {
  return { ...draftToTrack({ artist: 'The Weeknd', title: 'Blinding Lights' }, 'manual'), ...overrides };
}

function matched(recordings: ReturnType<typeof recording>[], searchedAt = NOW, extra: Partial<Track['match']> = {}): Track {
  const t = track();
  const candidates = rankCandidates(t, recordings);
  return { ...t, match: { phase: 'done', candidates, selectedId: candidates[0]?.recording.id, searchedAt, ...extra } };
}

describe('acquisition providers', () => {
  it('covers the four stores and three pools with the access levels from the README', () => {
    expect(ACQUISITION_PROVIDERS.map((p) => [p.id, p.kind, p.access])).toEqual([
      ['itunes', 'store', 'catalog-api'],
      ['amazon', 'store', 'search-link'],
      ['beatport', 'store', 'search-link'],
      ['bandcamp', 'store', 'search-link'],
      ['djcity', 'pool', 'entry-point'],
      ['bpm-supreme', 'pool', 'entry-point'],
      ['zipdj', 'pool', 'entry-point'],
    ]);
  });

  it('builds https search links on each provider’s own host with an encoded term', () => {
    const t = track({ artist: 'Mark Ronson feat. Bruno Mars', title: 'Uptown Funk & More' });
    const urls = ACQUISITION_PROVIDERS.filter((p) => p.searchUrl).map((p) => new URL(p.searchUrl!(t, 'GB', ['Extended'])));
    expect(urls.map((u) => u.hostname)).toEqual(['www.amazon.co.uk', 'www.beatport.com', 'bandcamp.com']);
    for (const url of urls) {
      expect(url.protocol).toBe('https:');
      expect(url.search).toContain('Mark%20Ronson%20Uptown%20Funk%20%26%20More%20Extended');
    }
  });

  it('links pools to their own sites only', () => {
    for (const pool of ACQUISITION_PROVIDERS.filter((p) => p.kind === 'pool')) {
      expect(pool.searchUrl).toBeUndefined();
      expect(new URL(pool.entryUrl!).protocol).toBe('https:');
    }
  });

  it('lists the pools the user uses first', () => {
    expect(orderedPools(['zipdj']).map((p) => p.id)).toEqual(['zipdj', 'djcity', 'bpm-supreme']);
    expect(orderedPools([]).map((p) => p.id)).toEqual(['djcity', 'bpm-supreme', 'zipdj']);
  });
});

describe('evidenceFor', () => {
  const itunes = providerById('itunes');

  it('never claims availability for search links or pools', () => {
    const t = matched([recording()]);
    expect(evidenceFor(t, providerById('beatport'), NOW).state).toBe('search-only');
    expect(evidenceFor(t, providerById('djcity'), NOW).state).toBe('membership');
  });

  it('verifies an iTunes listing only with a track price and a confident match', () => {
    expect(evidenceFor(matched([recording()]), itunes, NOW)).toMatchObject({ state: 'verified', checkedAt: NOW });
    // Album-only: matched, but not sold as a track.
    expect(evidenceFor(matched([recording({ price: undefined })]), itunes, NOW).state).toBe('possible');
    // Priced, but a different version than requested.
    expect(evidenceFor(matched([recording({ title: 'Blinding Lights (Live)' })]), itunes, NOW).state).toBe('possible');
  });

  it('reports lookups in progress, failures, and empty results without inventing availability', () => {
    expect(evidenceFor(track(), itunes, NOW).state).toBe('checking');
    expect(evidenceFor(track({ match: { phase: 'error', candidates: [], error: 'Offline' } }), itunes, NOW)).toMatchObject({
      state: 'unable',
      label: 'Unable to check: Offline',
    });
    expect(evidenceFor(matched([]), itunes, NOW)).toMatchObject({ state: 'not-found', label: 'Not found in this lookup' });
  });

  it('asks for a refresh once catalog evidence is older than 30 days', () => {
    const old = NOW - CATALOG_EVIDENCE_TTL_MS - 1;
    expect(evidenceFor(matched([recording()], old), itunes, NOW)).toMatchObject({ state: 'stale', checkedAt: old });
    expect(evidenceFor(matched([recording()], NOW - CATALOG_EVIDENCE_TTL_MS), itunes, NOW).state).toBe('verified');
  });
});

describe('acquisition choices', () => {
  it('records the chosen source and opened links without changing purchase status', () => {
    const t = track();
    let ws = workspaceReducer(
      { playlists: [{ id: 'p', name: 'P', createdAt: 0, tracks: [t] }], activePlaylistId: 'p', settings: { country: 'US', explicitPreference: 'any', searchModifiers: [], autoMatch: true, poolsIUse: [] } },
      { type: 'markOpened', id: t.id, provider: 'djcity', at: 5 },
    );
    ws = workspaceReducer(ws, { type: 'setAcquisitionSource', id: t.id, source: 'djcity' });
    expect(ws.playlists[0]?.tracks[0]).toMatchObject({ status: 'not_started', acquisition: { source: 'djcity', opened: { djcity: 5 } } });
    ws = workspaceReducer(ws, { type: 'setAcquisitionSource', id: t.id, source: undefined });
    expect(ws.playlists[0]?.tracks[0]?.acquisition).toEqual({ source: undefined, opened: { djcity: 5 } });
  });
});

describe('openedText', () => {
  const MIN = 60_000;

  it('rounds into minutes, hours, then days', () => {
    expect(openedText(undefined, NOW)).toBeUndefined();
    expect(openedText(NOW - 59 * MIN, NOW)).toBe('Opened 59 minutes ago');
    expect(openedText(NOW - 60 * MIN, NOW)).toBe('Opened 1 hour ago');
    expect(openedText(NOW - 47 * 60 * MIN, NOW)).toBe('Opened 47 hours ago');
    expect(openedText(NOW - 48 * 60 * MIN, NOW)).toBe('Opened 2 days ago');
  });

  it('reads a link opened after the panel rendered as this minute', () => {
    expect(openedText(NOW + 5 * MIN, NOW)).toBe('Opened this minute');
  });
});
