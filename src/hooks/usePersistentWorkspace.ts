import { useEffect, useReducer, useRef, useState } from 'react';
import type { Workspace } from '../types';
import { loadWorkspace, saveWorkspace, type StorageLike } from '../state/storage';
import { workspaceReducer } from '../state/workspace';

export interface PersistenceStatus {
  /** One-off message shown after recovering from unreadable stored data. */
  recoveryMessage?: string;
  /** Present while saving is failing. */
  saveError?: string;
}

/** Workspace state backed by localStorage, saved shortly after each change. */
export function usePersistentWorkspace(storage?: StorageLike, saveDelayMs = 250) {
  const [initial] = useState(() => loadWorkspace(storage));
  const [workspace, dispatch] = useReducer(workspaceReducer, initial.workspace);
  const [status, setStatus] = useState<PersistenceStatus>(() => ({
    recoveryMessage:
      initial.kind === 'recovered'
        ? initial.message
        : initial.kind === 'restored' && initial.droppedTracks > 0
          ? `${initial.droppedTracks} saved track(s) were unreadable and were skipped.`
          : undefined,
  }));
  const latest = useRef<Workspace>(workspace);

  useEffect(() => {
    latest.current = workspace;
    const timer = setTimeout(() => {
      const result = saveWorkspace(workspace, storage);
      setStatus((prev) => {
        const saveError = result.ok ? undefined : result.message;
        return prev.saveError === saveError ? prev : { ...prev, saveError };
      });
    }, saveDelayMs);
    return () => clearTimeout(timer);
  }, [workspace, storage, saveDelayMs]);

  // Flush pending changes when the tab is hidden or closed.
  useEffect(() => {
    const flush = () => saveWorkspace(latest.current, storage);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [storage]);

  const dismissRecovery = () => setStatus((prev) => ({ ...prev, recoveryMessage: undefined }));

  return { workspace, dispatch, persistence: status, dismissRecovery };
}
