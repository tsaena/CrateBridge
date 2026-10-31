import { describe, expect, it } from 'vitest';
import { BACKUP_KEY, SCHEMA_VERSION, STORAGE_KEY, loadWorkspace, saveWorkspace, type StorageLike } from './storage';
import { emptyWorkspace, workspaceReducer } from './workspace';
import { rankCandidates } from '../lib/matching/rank';
import { recording } from '../test/fixtures';

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k]! : null),
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
}

function sampleWorkspace() {
  let ws = workspaceReducer(emptyWorkspace(), {
    type: 'import',
    source: 'paste',
    drafts: [
      { artist: 'The Weeknd', title: 'Blinding Lights' },
      { artist: 'Daft Punk', title: 'One More Time' },
    ],
  });
  const [first, second] = ws.tracks;
  const candidates = rankCandidates(first!, [recording(), recording({ title: 'Blinding Lights (Live)' })]);
  ws = workspaceReducer(ws, { type: 'matchStarted', id: first!.id, signature: 's' });
  ws = workspaceReducer(ws, { type: 'matchResolved', id: first!.id, signature: 's', candidates, at: 5 });
  ws = workspaceReducer(ws, { type: 'selectCandidate', id: first!.id, candidateId: candidates[1]!.recording.id });
  ws = workspaceReducer(ws, { type: 'setStatus', ids: [first!.id], status: 'purchased' });
  ws = workspaceReducer(ws, { type: 'matchStarted', id: second!.id, signature: 's2' });
  ws = workspaceReducer(ws, { type: 'updateSettings', changes: { country: 'GB', explicitPreference: 'clean', searchModifiers: ['Extended'] } });
  return ws;
}

describe('workspace persistence', () => {
  it('starts empty when nothing is stored', () => {
    expect(loadWorkspace(memoryStorage()).kind).toBe('empty');
    expect(loadWorkspace(undefined).kind).toBe('empty');
  });

  it('round-trips tracks, selections, statuses, and settings', () => {
    const storage = memoryStorage();
    let ws = sampleWorkspace();
    // Settings changes re-queue tracks; resolve the first one again so it has a selection to persist.
    const first = ws.tracks[0]!;
    const candidates = rankCandidates(first, [recording(), recording({ title: 'Blinding Lights (Live)' })]);
    ws = workspaceReducer(ws, { type: 'matchStarted', id: first.id, signature: 'x' });
    ws = workspaceReducer(ws, { type: 'matchResolved', id: first.id, signature: 'x', candidates, at: 9 });
    ws = workspaceReducer(ws, { type: 'selectCandidate', id: first.id, candidateId: candidates[1]!.recording.id });

    expect(saveWorkspace(ws, storage)).toEqual({ ok: true });
    const loaded = loadWorkspace(storage);
    expect(loaded.kind).toBe('restored');
    const restored = loaded.workspace;
    expect(restored.settings).toEqual({ country: 'GB', explicitPreference: 'clean', searchModifiers: ['Extended'], autoMatch: true });
    expect(restored.tracks[0]).toMatchObject({
      id: first.id,
      status: 'purchased',
      match: { phase: 'done', selectedId: candidates[1]!.recording.id, userSelected: true },
    });
    expect(restored.tracks[0]?.match.candidates).toHaveLength(2);
    expect(restored.tracks[0]?.match.candidates[0]?.reasons.length).toBeGreaterThan(0);
  });

  it('re-queues lookups that were in progress when the page closed', () => {
    const storage = memoryStorage();
    let ws = workspaceReducer(emptyWorkspace(), { type: 'import', source: 'paste', drafts: [{ artist: 'A', title: 'B' }] });
    ws = workspaceReducer(ws, { type: 'matchStarted', id: ws.tracks[0]!.id, signature: 's' });
    saveWorkspace(ws, storage);
    expect(loadWorkspace(storage).workspace.tracks[0]?.match.phase).toBe('queued');
  });

  it('recovers from corrupted JSON and keeps a backup', () => {
    const storage = memoryStorage({ [STORAGE_KEY]: '{"version":1,"workspace":{"tracks":[' });
    const loaded = loadWorkspace(storage);
    expect(loaded.kind).toBe('recovered');
    expect(loaded.workspace.tracks).toEqual([]);
    expect(storage.data[BACKUP_KEY]).toBe('{"version":1,"workspace":{"tracks":[');
  });

  it('recovers from an unexpected shape', () => {
    const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify(['not', 'a', 'workspace']) });
    expect(loadWorkspace(storage).kind).toBe('recovered');
  });

  it('does not overwrite data from a newer version', () => {
    const raw = JSON.stringify({ version: SCHEMA_VERSION + 1, workspace: { tracks: [] } });
    const storage = memoryStorage({ [STORAGE_KEY]: raw });
    const loaded = loadWorkspace(storage);
    expect(loaded.kind).toBe('recovered');
    expect(storage.data[BACKUP_KEY]).toBe(raw);
  });

  it('drops invalid tracks and repairs invalid fields', () => {
    const raw = JSON.stringify({
      version: 1,
      workspace: {
        settings: { country: 'not-a-country', explicitPreference: 'loud', searchModifiers: ['Extended', 7], autoMatch: 'yes' },
        tracks: [
          { id: 't1', artist: 'A', title: 'B', status: 'bought', source: 'teleport', match: { phase: 'done', candidates: [{ recording: { id: 'x', title: 'B', artist: 'A', listingUrl: 'javascript:alert(1)', price: '1.29' }, confidence: 'certain', reasons: [{ effect: 'plus', text: 'ok' }, { text: 5 }] }] } },
          { id: 't1', artist: 'Dup', title: 'Id' },
          { artist: 'No', title: 'Id' },
          { id: 't3', artist: '', title: '' },
          'garbage',
          { id: 't4', artist: 'C', title: 'D', match: 'broken' },
        ],
      },
    });
    const loaded = loadWorkspace(memoryStorage({ [STORAGE_KEY]: raw }));
    expect(loaded.kind).toBe('restored');
    if (loaded.kind !== 'restored') return;
    expect(loaded.droppedTracks).toBe(4);
    expect(loaded.workspace.settings).toEqual({ country: 'US', explicitPreference: 'any', searchModifiers: ['Extended'], autoMatch: true });
    const [t1, t4] = loaded.workspace.tracks;
    expect(t1).toMatchObject({ id: 't1', status: 'not_started', source: 'manual' });
    const candidate = t1?.match.candidates[0];
    expect(candidate?.recording.listingUrl).toBeUndefined();
    expect(candidate?.recording.price).toBeUndefined();
    expect(candidate?.confidence).toBe('review');
    expect(candidate?.reasons).toEqual([{ effect: 'plus', text: 'ok' }]);
    expect(t4?.match).toEqual({ phase: 'queued', candidates: [] });
  });

  it('adds the iTunes Store parameter to listing links saved by earlier versions', () => {
    const raw = JSON.stringify({
      version: 1,
      workspace: {
        tracks: [{ id: 't1', artist: 'A', title: 'B', match: { phase: 'done', candidates: [
          { recording: { id: 'itunes:1', title: 'B', artist: 'A', listingUrl: 'https://music.apple.com/us/album/b/1?i=2&uo=4' }, confidence: 'high', reasons: [] },
        ] } }],
      },
    });
    const url = loadWorkspace(memoryStorage({ [STORAGE_KEY]: raw })).workspace.tracks[0]?.match.candidates[0]?.recording.listingUrl;
    expect(url).toBe('https://music.apple.com/us/album/b/1?i=2&uo=4&app=itunes');
  });

  it('reports save failures such as a full quota', () => {
    const storage: StorageLike = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      },
      removeItem: () => undefined,
    };
    expect(saveWorkspace(emptyWorkspace(), storage)).toMatchObject({ ok: false });
  });

  it('treats unreadable storage as empty', () => {
    const storage: StorageLike = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    expect(loadWorkspace(storage).kind).toBe('empty');
  });
});
