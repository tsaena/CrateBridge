import { describe, expect, it } from 'vitest';
import { BACKUP_KEY, SCHEMA_VERSION, STORAGE_KEY, loadWorkspace, saveWorkspace, type StorageLike } from './storage';
import { activePlaylist, emptyWorkspace, workspaceReducer } from './workspace';
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
  const [first, second] = activePlaylist(ws).tracks;
  const candidates = rankCandidates(first!, [recording(), recording({ title: 'Blinding Lights (Live)' })]);
  ws = workspaceReducer(ws, { type: 'matchStarted', id: first!.id, signature: 's' });
  ws = workspaceReducer(ws, { type: 'matchResolved', id: first!.id, signature: 's', candidates, at: 5 });
  ws = workspaceReducer(ws, { type: 'selectCandidate', id: first!.id, candidateId: candidates[1]!.recording.id });
  ws = workspaceReducer(ws, { type: 'setStatus', ids: [first!.id], status: 'purchased' });
  ws = workspaceReducer(ws, { type: 'matchStarted', id: second!.id, signature: 's2' });
  ws = workspaceReducer(ws, { type: 'updateSettings', changes: { country: 'GB', explicitPreference: 'clean', searchModifiers: ['Extended'], poolsIUse: ['djcity'] } });
  ws = workspaceReducer(ws, { type: 'setAcquisitionSource', id: first!.id, source: 'beatport' });
  ws = workspaceReducer(ws, { type: 'markOpened', id: first!.id, provider: 'beatport', at: 1_700_000_000_000 });
  return ws;
}

describe('workspace persistence', () => {
  it('restores Spotify provenance and rejects unsafe attribution URLs without changing older saves', () => {
    const storage = memoryStorage();
    const url = 'https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b';
    const ws = workspaceReducer(emptyWorkspace(), {
      type: 'import', source: 'spotify', drafts: [{ artist: 'The Weeknd', title: 'Blinding Lights', spotifyUrl: url, explicit: false }],
    });
    saveWorkspace(ws, storage);
    expect(activePlaylist(loadWorkspace(storage).workspace).tracks[0]).toMatchObject({ source: 'spotify', spotifyUrl: url, explicit: false });
    const raw = JSON.parse(storage.data[STORAGE_KEY]!);
    raw.workspace.playlists[0].tracks[0].spotifyUrl = 'javascript:alert(1)';
    storage.data[STORAGE_KEY] = JSON.stringify(raw);
    expect(activePlaylist(loadWorkspace(storage).workspace).tracks[0]?.spotifyUrl).toBeUndefined();
  });

  it('starts empty when nothing is stored', () => {
    expect(loadWorkspace(memoryStorage()).kind).toBe('empty');
    expect(loadWorkspace(undefined).kind).toBe('empty');
  });

  it('round-trips tracks, selections, statuses, and settings', () => {
    const storage = memoryStorage();
    let ws = sampleWorkspace();
    // Settings changes re-queue tracks; resolve the first one again so it has a selection to persist.
    const first = activePlaylist(ws).tracks[0]!;
    const candidates = rankCandidates(first, [recording(), recording({ title: 'Blinding Lights (Live)' })]);
    ws = workspaceReducer(ws, { type: 'matchStarted', id: first.id, signature: 'x' });
    ws = workspaceReducer(ws, { type: 'matchResolved', id: first.id, signature: 'x', candidates, at: 9 });
    ws = workspaceReducer(ws, { type: 'selectCandidate', id: first.id, candidateId: candidates[1]!.recording.id });
    const firstPlaylist = ws.activePlaylistId;
    ws = workspaceReducer(ws, { type: 'createPlaylist', name: 'Friday set' });
    ws = workspaceReducer(ws, { type: 'import', source: 'manual', drafts: [{ artist: 'Robyn', title: 'Dancing On My Own' }] });
    ws = workspaceReducer(ws, { type: 'switchPlaylist', id: firstPlaylist });

    expect(saveWorkspace(ws, storage)).toEqual({ ok: true });
    // Ratings and reasons are recomputed on load, so they aren't stored.
    expect(storage.data[STORAGE_KEY]).not.toContain('"reasons"');
    const loaded = loadWorkspace(storage);
    expect(loaded.kind).toBe('restored');
    const restored = loaded.workspace;
    expect(restored.playlists.map((p) => [p.name, p.tracks.length])).toEqual([['My playlist', 2], ['Friday set', 1]]);
    expect(restored.activePlaylistId).toBe(firstPlaylist);
    expect(restored.settings).toEqual({ country: 'GB', explicitPreference: 'clean', searchModifiers: ['Extended'], autoMatch: true, poolsIUse: ['djcity'] });
    expect(activePlaylist(restored).tracks[0]).toMatchObject({
      id: first.id,
      status: 'purchased',
      acquisition: { source: 'beatport', opened: { beatport: 1_700_000_000_000 } },
      match: { phase: 'done', selectedId: candidates[1]!.recording.id, userSelected: true },
    });
    expect(activePlaylist(restored).tracks[0]?.match.candidates).toHaveLength(2);
    expect(activePlaylist(restored).tracks[0]?.match.candidates[0]?.reasons.length).toBeGreaterThan(0);
  });

  it('migrates a version 1 workspace into a first playlist and re-rates its matches', () => {
    // Saved before producer-named edits were recognized, so the edit was rated High.
    const edit = recording({ artist: 'Lady Gaga', title: 'Poker Face (Jody Den Broeder Edit)' });
    const raw = JSON.stringify({
      version: 1,
      workspace: {
        settings: { country: 'CA' },
        tracks: [{ id: 't1', artist: 'Lady Gaga', title: 'Poker Face', status: 'found', match: {
          phase: 'done', selectedId: edit.id, candidates: [{ recording: edit, score: 99, confidence: 'high', reasons: [] }],
        } }],
      },
    });
    const loaded = loadWorkspace(memoryStorage({ [STORAGE_KEY]: raw }));
    expect(loaded.kind).toBe('restored');
    const { playlists, activePlaylistId, settings } = loaded.workspace;
    expect(playlists).toHaveLength(1);
    expect(playlists[0]).toMatchObject({ id: activePlaylistId, name: 'My playlist' });
    expect(settings.country).toBe('CA');
    expect(playlists[0]?.tracks[0]).toMatchObject({ id: 't1', status: 'found' });
    expect(playlists[0]?.tracks[0]?.match.candidates[0]?.confidence).toBe('review');
  });

  it('re-queues lookups that were in progress when the page closed', () => {
    const storage = memoryStorage();
    let ws = workspaceReducer(emptyWorkspace(), { type: 'import', source: 'paste', drafts: [{ artist: 'A', title: 'B' }] });
    ws = workspaceReducer(ws, { type: 'matchStarted', id: activePlaylist(ws).tracks[0]!.id, signature: 's' });
    saveWorkspace(ws, storage);
    expect(activePlaylist(loadWorkspace(storage).workspace).tracks[0]?.match.phase).toBe('queued');
  });

  it('recovers from corrupted JSON and keeps a backup', () => {
    const storage = memoryStorage({ [STORAGE_KEY]: '{"version":1,"workspace":{"tracks":[' });
    const loaded = loadWorkspace(storage);
    expect(loaded.kind).toBe('recovered');
    expect(activePlaylist(loaded.workspace).tracks).toEqual([]);
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
        settings: { country: 'not-a-country', explicitPreference: 'loud', searchModifiers: ['Extended', 7], autoMatch: 'yes', poolsIUse: ['djcity', 'djcity', 'napster', 3] },
        tracks: [
          { id: 't1', artist: 'A', title: 'B', status: 'bought', source: 'teleport', match: { phase: 'done', candidates: [{ recording: { id: 'x', title: 'B', artist: 'A', listingUrl: 'javascript:alert(1)', artworkUrl: 'https://tracker.example.com/pixel.gif', price: '1.29' }, confidence: 'certain', reasons: [{ effect: 'plus', text: 'ok' }, { text: 5 }] }] } },
          { id: 't1', artist: 'Dup', title: 'Id' },
          { artist: 'No', title: 'Id' },
          { id: 't3', artist: '', title: '' },
          'garbage',
          { id: 't4', artist: 'C', title: 'D', match: 'broken', acquisition: { source: 'limewire', opened: { beatport: 5, napster: 6, bandcamp: 'soon', djcity: -1 } } },
        ],
      },
    });
    const loaded = loadWorkspace(memoryStorage({ [STORAGE_KEY]: raw }));
    expect(loaded.kind).toBe('restored');
    if (loaded.kind !== 'restored') return;
    expect(loaded.droppedTracks).toBe(4);
    expect(loaded.workspace.settings).toEqual({ country: 'US', explicitPreference: 'any', searchModifiers: ['Extended'], autoMatch: true, poolsIUse: ['djcity'] });
    const [t1, t4] = activePlaylist(loaded.workspace).tracks;
    expect(t1).toMatchObject({ id: 't1', status: 'not_started', source: 'manual' });
    const candidate = t1?.match.candidates[0];
    expect(candidate?.recording.listingUrl).toBeUndefined();
    expect(candidate?.recording.artworkUrl).toBeUndefined();
    expect(candidate?.recording.price).toBeUndefined();
    // Stored ratings are ignored and recomputed from the recording itself.
    expect(candidate?.confidence).toBe('high');
    expect(candidate?.reasons.map((r) => r.text)).toContain('Title matches');
    expect(candidate?.reasons.map((r) => r.text)).not.toContain('ok');
    expect(t4?.match).toEqual({ phase: 'queued', candidates: [] });
    // Unknown providers and bad timestamps are dropped.
    expect(t4?.acquisition).toEqual({ source: undefined, opened: { beatport: 5 } });
    expect(t1?.acquisition).toBeUndefined();
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
    const url = activePlaylist(loadWorkspace(memoryStorage({ [STORAGE_KEY]: raw })).workspace).tracks[0]?.match.candidates[0]?.recording.listingUrl;
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
