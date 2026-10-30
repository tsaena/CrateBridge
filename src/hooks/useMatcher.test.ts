import { useReducer } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CatalogSearchService } from '../lib/catalog/searchService';
import { CatalogError, type CatalogProvider } from '../lib/providers/types';
import { emptyWorkspace, workspaceReducer } from '../state/workspace';
import { recording } from '../test/fixtures';
import type { CatalogRecording } from '../types';
import { useMatcher } from './useMatcher';

function setup() {
  const pending: { signal?: AbortSignal; resolve: (results: CatalogRecording[]) => void }[] = [];
  const search = vi.fn<CatalogProvider['search']>((_query, signal) => new Promise((resolve, reject) => {
    pending.push({ signal, resolve });
    signal?.addEventListener('abort', () => reject(new CatalogError('aborted', 'Search cancelled.')), { once: true });
  }));
  const service = new CatalogSearchService({ id: 'itunes', name: 'Test', search }, { minIntervalMs: 0, maxRetries: 0 });
  const hook = renderHook(() => {
    const [workspace, dispatch] = useReducer(workspaceReducer, undefined, () => workspaceReducer(emptyWorkspace(), {
      type: 'import', source: 'paste', drafts: [{ artist: 'The Weeknd', title: 'Blinding Lights' }],
    }));
    useMatcher(workspace, dispatch, service);
    return { workspace, dispatch };
  });
  return { ...hook, search, pending };
}

describe('useMatcher recovery', () => {
  it('completes a new lookup after undoing removal of a searching track', async () => {
    const { result, pending, search } = setup();
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    const track = result.current.workspace.tracks[0]!;
    act(() => result.current.dispatch({ type: 'delete', ids: [track.id] }));
    expect(pending[0]?.signal?.aborted).toBe(true);
    act(() => result.current.dispatch({ type: 'restore', entries: [{ track, index: 0 }] }));
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2));
    const candidate = recording();
    await act(async () => pending[1]!.resolve([candidate]));
    await waitFor(() => expect(result.current.workspace.tracks[0]?.match).toMatchObject({
      phase: 'done', selectedId: candidate.id,
    }));
  });

  it('uses the current preference before truncating an in-flight result set even with auto-match paused', async () => {
    const { result, pending, search } = setup();
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    act(() => result.current.dispatch({ type: 'updateSettings', changes: { explicitPreference: 'clean', autoMatch: false } }));
    expect(pending[0]?.signal?.aborted).toBe(false);
    // The clean recording would fall outside the eight stored results under the old preference.
    const explicit = Array.from({ length: 8 }, () => recording({ explicitness: 'explicit' }));
    const clean = recording({ explicitness: 'clean' });
    await act(async () => pending[0]!.resolve([...explicit, clean]));
    await waitFor(() => expect(result.current.workspace.tracks[0]?.match).toMatchObject({
      phase: 'done', selectedId: clean.id,
    }));
    expect(result.current.workspace.tracks[0]?.match.candidates).toHaveLength(8);
    expect(search).toHaveBeenCalledTimes(1);
  });
});
