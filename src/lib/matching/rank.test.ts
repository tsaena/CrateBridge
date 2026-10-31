import { describe, expect, it } from 'vitest';
import { rankCandidates, scoreCandidate } from './rank';
import { catalogQueries } from './matchTrack';
import { analyzeTitle, normalizeText } from '../normalize';
import { recording } from '../../test/fixtures';

const request = { artist: 'The Weeknd', title: 'Blinding Lights' };

describe('normalization', () => {
  it('ignores case, accents, and punctuation', () => {
    expect(normalizeText('Beyoncé – HALO!')).toBe(normalizeText('beyonce halo'));
    expect(normalizeText("Don’t Stop Me Now")).toBe(normalizeText("Don't Stop Me Now"));
    expect(normalizeText('Simon & Garfunkel')).toBe(normalizeText('Simon and Garfunkel'));
  });

  it('separates the core title, featured artists, and version tags', () => {
    expect(analyzeTitle('Uptown Funk (feat. Bruno Mars)')).toMatchObject({ core: 'uptown funk', featured: ['Bruno Mars'], tags: [] });
    expect(analyzeTitle('Summer (Extended Mix)').tags).toEqual(['extended']);
    expect(analyzeTitle('Levels - Radio Edit').tags).toEqual(['radio_edit']);
    expect(analyzeTitle('Dreams - 2004 Remaster').tags).toEqual(['remaster']);
    expect(analyzeTitle('Hey Ya! [Live]').tags).toEqual(['live']);
    expect(analyzeTitle('Live Forever').tags).toEqual([]);
    // Producer-named DJ versions are remixes even without the word "remix".
    expect(analyzeTitle('Poker Face (Jody Den Broeder Edit)').tags).toEqual(['remix']);
    expect(analyzeTitle("Mr. Brightside (Jacques Lu Cont's Thin White Duke Mix)").tags).toEqual(['remix']);
    expect(analyzeTitle('Poker Face (Space Cowboy Dub)').tags).toEqual(['remix']);
    expect(analyzeTitle("Shake It Off (Taylor's Version)").tags).toEqual(['alt_version']);
    // Standard-release wording is not a different recording.
    expect(analyzeTitle('Yeah! (Album Version)').tags).toEqual([]);
    expect(analyzeTitle('Yeah! (Clean Edit)').tags).toEqual(['clean']);
    expect(analyzeTitle('Dreams (Remastered Version)').tags).toEqual(['remaster']);
    expect(analyzeTitle('I Wanna Dance with Somebody (Who Loves Me)')).toMatchObject({
      core: 'i wanna dance with somebody',
      featured: [],
    });
  });
});

describe('rankCandidates', () => {
  it('rates an exact artist and title match as high confidence', () => {
    const [top] = rankCandidates(request, [recording()]);
    expect(top?.confidence).toBe('high');
    expect(top?.reasons.map((r) => r.text)).toEqual(expect.arrayContaining(['Title matches', 'Artist matches']));
  });

  it('matches case-insensitively and ignores punctuation differences', () => {
    const [top] = rankCandidates({ artist: 'the weeknd', title: 'blinding lights!' }, [recording()]);
    expect(top?.confidence).toBe('high');
    const [mrB] = rankCandidates({ artist: 'The Killers', title: 'Mr Brightside' }, [
      recording({ artist: 'The Killers', title: 'Mr. Brightside' }),
    ]);
    expect(mrB?.confidence).toBe('high');
  });

  it('handles featured artists in either the artist or title field', () => {
    const catalog = recording({ artist: 'Mark Ronson', title: 'Uptown Funk (feat. Bruno Mars)' });
    expect(rankCandidates({ artist: 'Mark Ronson feat. Bruno Mars', title: 'Uptown Funk' }, [catalog])[0]?.confidence).toBe('high');
    expect(rankCandidates({ artist: 'Mark Ronson', title: 'Uptown Funk (feat. Bruno Mars)' }, [catalog])[0]?.confidence).toBe('high');
    expect(rankCandidates({ artist: 'Mark Ronson, Bruno Mars', title: 'Uptown Funk' }, [catalog])[0]?.confidence).toBe('high');

    const credited = recording({ artist: 'Usher, Lil Jon & Ludacris', title: 'Yeah! (feat. Lil Jon & Ludacris)' });
    expect(rankCandidates({ artist: 'Usher', title: 'Yeah!' }, [credited])[0]?.confidence).toBe('high');
  });

  it('prefers the studio recording over live and remix versions when none was requested', () => {
    const live = recording({ title: 'Blinding Lights (Live)', album: 'Live at SoFi Stadium' });
    const remix = recording({ title: 'Blinding Lights (Chromatics Remix)' });
    const studio = recording();
    const ranked = rankCandidates(request, [live, remix, studio]);
    expect(ranked[0]?.recording.id).toBe(studio.id);
    expect(ranked.find((c) => c.recording.id === live.id)?.confidence).toBe('review');
    expect(ranked.find((c) => c.recording.id === remix.id)?.confidence).toBe('review');
  });

  it('does not treat a producer-named edit as the requested original', () => {
    const edit = recording({ artist: 'Lady Gaga', title: 'Poker Face (Jody Den Broeder Edit)' });
    const original = recording({ artist: 'Lady Gaga', title: 'Poker Face' });
    const ranked = rankCandidates({ artist: 'Lady Gaga', title: 'Poker Face' }, [edit, original]);
    expect(ranked[0]?.recording.id).toBe(original.id);
    expect(ranked[1]?.confidence).toBe('review');
  });

  it('detects live recordings from album metadata', () => {
    const liveAlbum = recording({ album: 'Live at Wembley' });
    const [scored] = rankCandidates(request, [liveAlbum]);
    expect(scored?.confidence).toBe('review');
    expect(scored?.reasons.some((r) => r.text.startsWith('Live version'))).toBe(true);
  });

  it('prefers the requested remix over the original', () => {
    const want = { artist: 'The Weeknd', title: 'Blinding Lights (Chromatics Remix)' };
    const original = recording();
    const otherRemix = recording({ title: 'Blinding Lights (Major Lazer Remix)' });
    const chromatics = recording({ title: 'Blinding Lights (Chromatics Remix)' });
    const ranked = rankCandidates(want, [original, otherRemix, chromatics]);
    expect(ranked[0]?.recording.id).toBe(chromatics.id);
    expect(ranked[0]?.confidence).toBe('high');
    expect(ranked.find((c) => c.recording.id === original.id)?.confidence).toBe('review');
    expect(ranked.find((c) => c.recording.id === otherRemix.id)?.confidence).toBe('review');
  });

  it.each([
    ['David Guetta', 'David Morales'],
    ['David Guetta', 'Guetta'],
    ['Guetta', 'David Guetta'],
  ])('does not confirm different remixers %s and %s', (requested, other) => {
    const want = { ...request, title: `Blinding Lights (${requested} Remix)` };
    const wrong = recording({ title: `Blinding Lights (${other} Remix)` });
    const correct = recording({ title: `Blinding Lights (${requested} Remix)` });
    const ranked = rankCandidates(want, [wrong, correct]);
    expect(ranked[0]?.recording.id).toBe(correct.id);
    expect(ranked[0]?.confidence).toBe('high');
    expect(ranked[1]?.confidence).toBe('review');
    expect(ranked[1]?.reasons.map((r) => r.text)).toContain('Different remix');
    expect(ranked[1]?.reasons.map((r) => r.text)).not.toContain('Remixer matches');
  });

  it('recognizes a remixer despite normalized spelling and extra version wording', () => {
    const want = { ...request, title: 'Blinding Lights (David Guetta Remix)' };
    const candidate = recording({ title: 'Blinding Lights (DAVID GUETTA Extended Remix)' });
    const result = scoreCandidate(want, candidate);
    expect(result.confidence).toBe('high');
    expect(result.reasons.map((r) => r.text)).toContain('Remixer matches');
  });

  it('pushes karaoke and tribute recordings to the bottom', () => {
    const karaoke = recording({ artist: 'Karaoke Hits Band', title: 'Blinding Lights (Originally Performed by The Weeknd)' });
    const tribute = recording({ artist: 'The Weeknd Tribute Band', album: 'A Tribute to The Weeknd' });
    const studio = recording();
    const ranked = rankCandidates(request, [karaoke, tribute, studio]);
    expect(ranked[0]?.recording.id).toBe(studio.id);
    expect(ranked.slice(1).every((c) => c.confidence !== 'high')).toBe(true);
  });

  it('applies clean and explicit preferences', () => {
    const explicit = recording({ explicitness: 'explicit' });
    const clean = recording({ explicitness: 'clean' });
    expect(rankCandidates(request, [clean, explicit], 'any')[0]?.recording.id).toBe(explicit.id);
    expect(rankCandidates(request, [explicit, clean], 'clean')[0]?.recording.id).toBe(clean.id);
    expect(rankCandidates(request, [clean, explicit], 'explicit')[0]?.recording.id).toBe(explicit.id);
    // A "(Clean)" request overrides the workspace preference.
    expect(rankCandidates({ ...request, title: 'Blinding Lights (Clean)' }, [explicit, clean], 'explicit')[0]?.recording.id).toBe(clean.id);
  });

  it('keeps clean edits high-confidence when clean is preferred', () => {
    const clean = recording({ explicitness: 'clean' });
    expect(scoreCandidate(request, clean, 'clean').confidence).toBe('high');
  });

  it('orders alternatives deterministically by score, purchasability, then release date', () => {
    const later = recording({ releaseDate: '2021-01-01T00:00:00Z' });
    const earlier = recording({ releaseDate: '2019-11-29T00:00:00Z' });
    const albumOnly = recording({ price: undefined, releaseDate: '2018-01-01T00:00:00Z' });
    const ranked = rankCandidates(request, [later, albumOnly, earlier]);
    expect(ranked.map((c) => c.recording.id)).toEqual([earlier.id, later.id, albumOnly.id]);
    expect(rankCandidates(request, [earlier, later, albumOnly]).map((c) => c.recording.id)).toEqual(
      ranked.map((c) => c.recording.id),
    );
  });

  it('rejects different songs and different artists', () => {
    const otherSong = recording({ title: 'Save Your Tears' });
    const otherArtist = recording({ artist: 'Some Cover Artist' });
    expect(rankCandidates(request, [otherSong])[0]?.confidence).toBe('none');
    expect(rankCandidates(request, [otherArtist])[0]?.confidence).not.toBe('high');
  });

  it('copes with missing metadata', () => {
    const sparse = recording({ album: undefined, durationMs: undefined, price: undefined, currency: undefined, listingUrl: undefined, releaseDate: undefined, explicitness: 'unknown' });
    const [scored] = rankCandidates({ artist: '', title: 'Blinding Lights' }, [sparse]);
    expect(scored?.confidence).toBe('review');
    expect(scored?.reasons.some((r) => r.text.includes('No individual track price'))).toBe(true);
  });

  it('uses duration and album to separate otherwise identical results', () => {
    const want = { ...request, durationMs: 200_000, album: 'After Hours' };
    const single = recording({ album: 'Blinding Lights - Single', durationMs: 222_000 });
    const albumCut = recording({ album: 'After Hours', durationMs: 200_040 });
    expect(rankCandidates(want, [single, albumCut])[0]?.recording.id).toBe(albumCut.id);
  });

  it('treats a matching ISRC as decisive', () => {
    const match = recording({ isrc: 'USUG11904206', title: 'Blinding Lights (Remastered)' });
    expect(scoreCandidate({ ...request, isrc: 'usug11904206' }, match).confidence).toBe('high');
  });

  it('removes duplicate results', () => {
    const one = recording();
    expect(rankCandidates(request, [one, one])).toHaveLength(1);
  });
});

describe('catalogQueries', () => {
  it('searches by primary artist and core title', () => {
    expect(catalogQueries({ artist: 'Usher feat. Lil Jon & Ludacris', title: 'Yeah!' })).toEqual(['Usher Yeah!', 'Yeah!']);
    expect(catalogQueries({ artist: 'Mark Ronson', title: 'Uptown Funk (feat. Bruno Mars)' })[0]).toBe('Mark Ronson Uptown Funk');
  });

  it('keeps version wording for versioned requests', () => {
    expect(catalogQueries({ artist: 'Purple Disco Machine', title: 'Hypnotized (Extended Mix)' })).toEqual([
      'Purple Disco Machine Hypnotized Extended Mix',
      'Purple Disco Machine Hypnotized',
    ]);
  });

  it('uses a custom query when set', () => {
    expect(catalogQueries({ artist: 'A', title: 'B', searchOverride: '  custom words ' })).toEqual(['custom words']);
  });
});
