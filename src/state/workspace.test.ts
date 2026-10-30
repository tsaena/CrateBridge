import { describe, expect, it } from 'vitest';
import type { RankedCandidate, Workspace } from '../types';
import { emptyWorkspace, selectedCandidate, workspaceReducer, type WorkspaceAction } from './workspace';
import { rankCandidates } from '../lib/matching/rank';
import { findDuplicates, findAlternateVersions } from '../lib/duplicates';
import { recording } from '../test/fixtures';

const run = (actions: WorkspaceAction[], start: Workspace = emptyWorkspace()) => actions.reduce(workspaceReducer, start);

function withTracks(...pairs: [string, string][]): Workspace {
  return run([{ type: 'import', source: 'paste', drafts: pairs.map(([artist, title]) => ({ artist, title })) }]);
}

function resolve(ws: Workspace, id: string, candidates: RankedCandidate[]): Workspace {
  return run(
    [
      { type: 'matchStarted', id, signature: 'sig' },
      { type: 'matchResolved', id, signature: 'sig', candidates, at: 1 },
    ],
    ws,
  );
}

describe('workspaceReducer', () => {
  it('imports drafts as queued, not-started tracks and ignores empty drafts', () => {
    const ws = run([
      {
        type: 'import',
        source: 'paste',
        drafts: [{ artist: ' The Weeknd ', title: 'Blinding Lights ' }, { artist: '', title: '  ' }],
      },
    ]);
    expect(ws.tracks).toHaveLength(1);
    expect(ws.tracks[0]).toMatchObject({ artist: 'The Weeknd', title: 'Blinding Lights', status: 'not_started', source: 'paste' });
    expect(ws.tracks[0]?.match.phase).toBe('queued');
  });

  it('moves between every status and back', () => {
    let ws = withTracks(['A', 'B']);
    const id = ws.tracks[0]!.id;
    for (const status of ['found', 'purchased', 'skipped', 'not_started'] as const) {
      ws = workspaceReducer(ws, { type: 'setStatus', ids: [id], status });
      expect(ws.tracks[0]?.status).toBe(status);
    }
  });

  it('resets every status at once', () => {
    let ws = withTracks(['A', 'B'], ['C', 'D']);
    ws = workspaceReducer(ws, { type: 'setStatus', ids: ws.tracks.map((t) => t.id), status: 'purchased' });
    ws = workspaceReducer(ws, { type: 'resetAllStatuses' });
    expect(ws.tracks.map((t) => t.status)).toEqual(['not_started', 'not_started']);
  });

  it('re-queues a track when its artist or title is edited, but not for no-op edits', () => {
    let ws = withTracks(['The Weekend', 'Blinding Lights']);
    const id = ws.tracks[0]!.id;
    ws = resolve(ws, id, rankCandidates(ws.tracks[0]!, [recording()]));
    expect(ws.tracks[0]?.match.phase).toBe('done');

    const same = workspaceReducer(ws, { type: 'update', id, changes: { artist: 'The Weekend ' } });
    expect(same).toBe(ws);

    ws = workspaceReducer(ws, { type: 'update', id, changes: { artist: 'The Weeknd' } });
    expect(ws.tracks[0]).toMatchObject({ artist: 'The Weeknd', match: { phase: 'queued', candidates: [] } });
  });

  it('keeps the status when a track is edited', () => {
    let ws = withTracks(['A', 'B']);
    const id = ws.tracks[0]!.id;
    ws = workspaceReducer(ws, { type: 'setStatus', ids: [id], status: 'found' });
    ws = workspaceReducer(ws, { type: 'update', id, changes: { title: 'C' } });
    expect(ws.tracks[0]?.status).toBe('found');
  });

  it('deletes tracks and restores them at their original positions', () => {
    let ws = withTracks(['A', '1'], ['B', '2'], ['C', '3']);
    const [a, b, c] = ws.tracks;
    ws = workspaceReducer(ws, { type: 'delete', ids: [a!.id, c!.id] });
    expect(ws.tracks.map((t) => t.artist)).toEqual(['B']);
    ws = workspaceReducer(ws, { type: 'restore', entries: [{ track: c!, index: 2 }, { track: a!, index: 0 }] });
    expect(ws.tracks.map((t) => t.id)).toEqual([a!.id, b!.id, c!.id]);
    // Restoring twice does not duplicate.
    expect(workspaceReducer(ws, { type: 'restore', entries: [{ track: a!, index: 0 }] }).tracks).toHaveLength(3);
  });

  it('requeues a cancelled lookup when a deleted track is restored', () => {
    let ws = withTracks(['The Weeknd', 'Blinding Lights']);
    const id = ws.tracks[0]!.id;
    ws = workspaceReducer(ws, { type: 'matchStarted', id, signature: 'cancelled' });
    const track = ws.tracks[0]!;
    ws = workspaceReducer(ws, { type: 'delete', ids: [id] });
    ws = workspaceReducer(ws, { type: 'restore', entries: [{ track, index: 0 }] });
    expect(ws.tracks[0]?.match).toMatchObject({ phase: 'queued', candidates: [] });
    expect(ws.tracks[0]?.match.signature).toBeUndefined();
    expect(workspaceReducer(ws, {
      type: 'matchResolved', id, signature: 'cancelled', candidates: [], at: 1,
    })).toBe(ws);
    ws = resolve(ws, id, rankCandidates(track, [recording()]));
    expect(ws.tracks[0]?.match.phase).toBe('done');
  });

  it('preserves completed results and manual selections when restored', () => {
    let ws = withTracks(['The Weeknd', 'Blinding Lights']);
    const id = ws.tracks[0]!.id;
    const candidate = recording();
    ws = resolve(ws, id, rankCandidates(ws.tracks[0]!, [candidate]));
    ws = workspaceReducer(ws, { type: 'selectCandidate', id, candidateId: candidate.id });
    const track = ws.tracks[0]!;
    ws = workspaceReducer(ws, { type: 'delete', ids: [id] });
    ws = workspaceReducer(ws, { type: 'restore', entries: [{ track, index: 0 }] });
    expect(ws.tracks[0]).toBe(track);
  });

  it('selects the top candidate when results arrive', () => {
    let ws = withTracks(['The Weeknd', 'Blinding Lights']);
    const id = ws.tracks[0]!.id;
    const candidates = rankCandidates(ws.tracks[0]!, [recording({ title: 'Blinding Lights (Live)' }), recording()]);
    ws = resolve(ws, id, candidates);
    expect(ws.tracks[0]?.match.selectedId).toBe(candidates[0]?.recording.id);
    expect(selectedCandidate(ws.tracks[0]!)?.recording.title).toBe('Blinding Lights');
  });

  it('ignores stale results for an edited or deleted track', () => {
    let ws = withTracks(['The Weeknd', 'Blinding Lights']);
    const id = ws.tracks[0]!.id;
    ws = workspaceReducer(ws, { type: 'matchStarted', id, signature: 'old' });
    ws = workspaceReducer(ws, { type: 'update', id, changes: { title: 'Save Your Tears' } });
    const after = workspaceReducer(ws, { type: 'matchResolved', id, signature: 'old', candidates: [], at: 1 });
    expect(after).toBe(ws);
    expect(workspaceReducer(ws, { type: 'matchFailed', id, signature: 'old', error: 'x' })).toBe(ws);

    const deleted = workspaceReducer(ws, { type: 'delete', ids: [id] });
    expect(workspaceReducer(deleted, { type: 'matchResolved', id, signature: 'old', candidates: [], at: 1 })).toBe(deleted);
  });

  it('records lookup failures and can retry only failed tracks', () => {
    let ws = withTracks(['A', 'B'], ['C', 'D']);
    const [first, second] = ws.tracks;
    ws = run(
      [
        { type: 'matchStarted', id: first!.id, signature: 's1' },
        { type: 'matchFailed', id: first!.id, signature: 's1', error: 'offline' },
        { type: 'matchStarted', id: second!.id, signature: 's2' },
        { type: 'matchResolved', id: second!.id, signature: 's2', candidates: [], at: 1 },
      ],
      ws,
    );
    expect(ws.tracks[0]?.match).toMatchObject({ phase: 'error', error: 'offline' });
    ws = workspaceReducer(ws, { type: 'requeue', onlyFailed: true });
    expect(ws.tracks.map((t) => t.match.phase)).toEqual(['queued', 'done']);
  });

  it('lets the user pick an alternative and keeps it when re-ranked', () => {
    let ws = withTracks(['The Weeknd', 'Blinding Lights']);
    const id = ws.tracks[0]!.id;
    const clean = recording({ explicitness: 'clean' });
    const explicit = recording({ explicitness: 'explicit' });
    ws = resolve(ws, id, rankCandidates(ws.tracks[0]!, [clean, explicit]));
    expect(ws.tracks[0]?.match.selectedId).toBe(explicit.id);

    ws = workspaceReducer(ws, { type: 'selectCandidate', id, candidateId: clean.id });
    expect(ws.tracks[0]?.match).toMatchObject({ selectedId: clean.id, userSelected: true });

    ws = workspaceReducer(ws, { type: 'updateSettings', changes: { explicitPreference: 'explicit' } });
    expect(ws.tracks[0]?.match.selectedId).toBe(clean.id);

    expect(workspaceReducer(ws, { type: 'selectCandidate', id, candidateId: 'itunes:unknown' })).toBe(ws);
  });

  it('re-ranks automatic picks when the clean/explicit preference changes', () => {
    let ws = withTracks(['The Weeknd', 'Blinding Lights']);
    const id = ws.tracks[0]!.id;
    const clean = recording({ explicitness: 'clean' });
    const explicit = recording({ explicitness: 'explicit' });
    ws = resolve(ws, id, rankCandidates(ws.tracks[0]!, [clean, explicit]));
    ws = workspaceReducer(ws, { type: 'updateSettings', changes: { explicitPreference: 'clean' } });
    expect(ws.tracks[0]?.match.selectedId).toBe(clean.id);
  });

  it('applies the latest explicit preference when in-flight results arrive', () => {
    let ws = withTracks(['The Weeknd', 'Blinding Lights']);
    const id = ws.tracks[0]!.id;
    const explicit = recording({ explicitness: 'explicit' });
    const clean = recording({ explicitness: 'clean' });
    const oldCandidates = rankCandidates(ws.tracks[0]!, [explicit, clean], 'any');
    expect(oldCandidates[0]?.recording.id).toBe(explicit.id);
    ws = workspaceReducer(ws, { type: 'matchStarted', id, signature: 'old' });
    ws = workspaceReducer(ws, { type: 'updateSettings', changes: { explicitPreference: 'clean' } });
    expect(ws.tracks[0]?.match.phase).toBe('searching');
    ws = workspaceReducer(ws, {
      type: 'matchResolved', id, signature: 'old', candidates: oldCandidates, at: 1,
    });
    expect(ws.tracks[0]?.match.selectedId).toBe(clean.id);
  });

  it('re-queues every track when the storefront changes', () => {
    let ws = withTracks(['The Weeknd', 'Blinding Lights']);
    ws = resolve(ws, ws.tracks[0]!.id, rankCandidates(ws.tracks[0]!, [recording()]));
    ws = workspaceReducer(ws, { type: 'updateSettings', changes: { country: 'GB' } });
    expect(ws.settings.country).toBe('GB');
    expect(ws.tracks[0]?.match.phase).toBe('queued');
  });

  it('clears the workspace but keeps settings', () => {
    let ws = withTracks(['A', 'B']);
    ws = workspaceReducer(ws, { type: 'updateSettings', changes: { country: 'CA' } });
    ws = workspaceReducer(ws, { type: 'clear' });
    expect(ws.tracks).toEqual([]);
    expect(ws.settings.country).toBe('CA');
  });
});

describe('duplicate detection', () => {
  it('groups tracks with the same normalized artist, title, and version', () => {
    const ws = withTracks(
      ['The Weeknd', 'Blinding Lights'],
      ['the weeknd', 'Blinding Lights!'],
      ['The Weeknd feat. Someone', 'Blinding Lights'],
      ['The Weeknd', 'Blinding Lights (Chromatics Remix)'],
      ['The Weeknd', 'Blinding Lights - 2020 Remaster'],
      ['Daft Punk', 'One More Time'],
    );
    const groups = findDuplicates(ws.tracks);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.keep.id).toBe(ws.tracks[0]?.id);
    expect(groups[0]?.remove.map((t) => t.id)).toEqual([ws.tracks[1]!.id, ws.tracks[2]!.id, ws.tracks[4]!.id]);
  });

  it('keeps the copy with the most progress', () => {
    let ws = withTracks(['A', 'Song'], ['A', 'Song']);
    ws = workspaceReducer(ws, { type: 'setStatus', ids: [ws.tracks[1]!.id], status: 'purchased' });
    expect(findDuplicates(ws.tracks)[0]?.keep.id).toBe(ws.tracks[1]?.id);
  });

  it('treats different remixes and live versions as legitimate alternates', () => {
    const ws = withTracks(['Calvin Harris', 'Summer'], ['Calvin Harris', 'Summer (R3hab Remix)'], ['Calvin Harris', 'Summer (Tiësto Remix)'], ['Calvin Harris', 'Summer - Live']);
    expect(findDuplicates(ws.tracks)).toEqual([]);
    expect(findAlternateVersions(ws.tracks).size).toBe(4);
  });
});
