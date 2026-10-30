import Papa from 'papaparse';
import { describe, expect, it } from 'vitest';
import type { Workspace } from '../types';
import { emptyWorkspace, workspaceReducer, type WorkspaceAction } from './workspace';
import { DEFAULT_VIEW, exportChecklistCsv, filterAndSort, matchClass, summarize } from './selectors';
import { rankCandidates } from '../lib/matching/rank';
import { recording } from '../test/fixtures';

function build(): Workspace {
  let ws = workspaceReducer(emptyWorkspace(), {
    type: 'import',
    source: 'paste',
    drafts: [
      { artist: 'The Weeknd', title: 'Blinding Lights' },
      { artist: 'Daft Punk', title: 'One More Time' },
      { artist: 'Avicii', title: 'Levels' },
      { artist: '=cmd', title: 'Injection' },
    ],
  });
  const [a, b, c] = ws.tracks;
  const resolve = (id: string, track: Workspace['tracks'][number], recs: ReturnType<typeof recording>[]): WorkspaceAction[] => [
    { type: 'matchStarted', id, signature: id },
    { type: 'matchResolved', id, signature: id, candidates: rankCandidates(track, recs), at: 1 },
  ];
  const actions: WorkspaceAction[] = [
    ...resolve(a!.id, a!, [recording({ price: 1.29 })]),
    ...resolve(b!.id, b!, [recording({ artist: 'Daft Punk', title: 'One More Time (Live)', price: 0.99 })]),
    ...resolve(c!.id, c!, [recording({ artist: 'Avicii', title: 'Levels', price: undefined })]),
    { type: 'setStatus', ids: [a!.id], status: 'purchased' },
  ];
  ws = actions.reduce(workspaceReducer, ws);
  return ws;
}

describe('summarize', () => {
  it('counts statuses and match classes', () => {
    const ws = build();
    expect(ws.tracks.map(matchClass)).toEqual(['high', 'review', 'high', 'pending']);
    expect(summarize(ws.tracks)).toMatchObject({
      total: 4,
      likely: 2,
      review: 1,
      pending: 1,
      purchased: 1,
      skipped: 0,
      remaining: 3,
    });
  });

  it('only adds known prices and reports unpriced tracks separately', () => {
    const summary = summarize(build().tracks);
    expect(summary.remainingCost).toEqual([{ currency: 'USD', amount: 0.99, count: 1 }]);
    expect(summary.spentCost).toEqual([{ currency: 'USD', amount: 1.29, count: 1 }]);
    expect(summary.unpricedRemaining).toBe(2);
  });

  it('excludes skipped tracks from remaining cost', () => {
    let ws = build();
    ws = workspaceReducer(ws, { type: 'setStatus', ids: [ws.tracks[1]!.id], status: 'skipped' });
    const summary = summarize(ws.tracks);
    expect(summary.remainingCost).toEqual([]);
    expect(summary.skipped).toBe(1);
    expect(summary.remaining).toBe(2);
  });
});

describe('filterAndSort', () => {
  it('filters by status, match class, and text', () => {
    const { tracks } = build();
    expect(filterAndSort(tracks, { ...DEFAULT_VIEW, status: 'purchased' }).map((t) => t.artist)).toEqual(['The Weeknd']);
    expect(filterAndSort(tracks, { ...DEFAULT_VIEW, status: 'remaining' })).toHaveLength(3);
    expect(filterAndSort(tracks, { ...DEFAULT_VIEW, match: 'review' }).map((t) => t.artist)).toEqual(['Daft Punk']);
    expect(filterAndSort(tracks, { ...DEFAULT_VIEW, match: 'pending' }).map((t) => t.artist)).toEqual(['=cmd']);
    expect(filterAndSort(tracks, { ...DEFAULT_VIEW, query: 'LEVEL' }).map((t) => t.artist)).toEqual(['Avicii']);
    expect(filterAndSort(tracks, { ...DEFAULT_VIEW, query: 'after hours' })).toHaveLength(3);
  });

  it('sorts by artist, attention needed, and price', () => {
    const { tracks } = build();
    expect(filterAndSort(tracks, { ...DEFAULT_VIEW, sort: 'artist' }).map((t) => t.artist)).toEqual(['=cmd', 'Avicii', 'Daft Punk', 'The Weeknd']);
    expect(filterAndSort(tracks, { ...DEFAULT_VIEW, sort: 'confidence' })[0]?.artist).toBe('Daft Punk');
    expect(filterAndSort(tracks, { ...DEFAULT_VIEW, sort: 'price' }).map((t) => t.artist)).toEqual(['Daft Punk', 'The Weeknd', 'Avicii', '=cmd']);
  });
});

describe('exportChecklistCsv', () => {
  it('exports a row per track with selected recording, price, status, and link', () => {
    const csv = exportChecklistCsv(build().tracks);
    const parsed = Papa.parse<Record<string, string>>(csv, { header: true }).data;
    expect(parsed).toHaveLength(4);
    expect(parsed[0]).toMatchObject({
      Artist: 'The Weeknd',
      Title: 'Blinding Lights',
      Status: 'Purchased',
      Match: 'High confidence',
      'Selected Recording': 'The Weeknd – Blinding Lights',
      Price: '1.29',
      Currency: 'USD',
      'Link Type': 'Verified iTunes Store listing',
    });
    expect(parsed[0]?.['Store Link']).toMatch(/^https:\/\/music\.apple\.com\//);
    expect(parsed[2]).toMatchObject({ Price: '', 'Link Type': 'Catalog listing (no individual price)' });
  });

  it('neutralizes spreadsheet formulas', () => {
    const parsed = Papa.parse<Record<string, string>>(exportChecklistCsv(build().tracks), { header: true }).data;
    expect(parsed[3]?.Artist).toBe("'=cmd");
  });
});
