import { useCallback, useEffect, useRef, useState, type Dispatch } from 'react';
import type { Workspace } from '../types';
import type { CatalogSearchService } from '../lib/catalog/searchService';
import type { PauseReason, RateLimiterSnapshot } from '../lib/catalog/rateLimiter';
import { findMatches, matchSignature } from '../lib/matching/matchTrack';
import { CatalogError } from '../lib/providers/types';
import type { WorkspaceAction } from '../state/workspace';

interface Running {
  id: string;
  signature: string;
  controller: AbortController;
}

export interface MatcherStatus {
  /** Tracks waiting for a catalog lookup, including the one in progress. */
  outstanding: number;
  running: boolean;
  /** Epoch ms until which Apple has asked us to back off. */
  pausedUntil: number;
  pauseReason?: PauseReason;
}

/**
 * Works through queued tracks one at a time. Tracks the user asks about are
 * moved to the front; everything else follows import order.
 */
export function useMatcher(workspace: Workspace, dispatch: Dispatch<WorkspaceAction>, service: CatalogSearchService) {
  const running = useRef<Running | null>(null);
  const priority = useRef<string[]>([]);
  const [tick, setTick] = useState(0);
  const [limiter, setLimiter] = useState<RateLimiterSnapshot>(() => service.limiter.snapshot());

  useEffect(() => service.limiter.subscribe(setLimiter), [service]);

  const { tracks, settings } = workspace;

  useEffect(() => {
    const current = running.current;
    if (current) {
      const track = tracks.find((t) => t.id === current.id);
      // The track was deleted, edited, or re-queued: cancel the stale request.
      if (!track || track.match.phase !== 'searching' || track.match.signature !== current.signature) {
        current.controller.abort();
        running.current = null;
      } else {
        return;
      }
    }

    priority.current = priority.current.filter((id) => tracks.some((t) => t.id === id && t.match.phase === 'queued'));
    const prioritized = priority.current[0];
    const next =
      (prioritized ? tracks.find((t) => t.id === prioritized) : undefined) ??
      (settings.autoMatch ? tracks.find((t) => t.match.phase === 'queued') : undefined);
    if (!next) return;

    priority.current = priority.current.filter((id) => id !== next.id);
    const signature = matchSignature(next, settings.country);
    const controller = new AbortController();
    const job: Running = { id: next.id, signature, controller };
    running.current = job;
    dispatch({ type: 'matchStarted', id: next.id, signature });

    findMatches(next, service, {
      country: settings.country,
      preference: settings.explicitPreference,
      signal: controller.signal,
      priority: Boolean(prioritized),
    })
      .then((candidates) => {
        if (!controller.signal.aborted) {
          dispatch({ type: 'matchResolved', id: next.id, signature, candidates, at: Date.now() });
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const message = error instanceof CatalogError ? error.message : 'Search failed.';
        dispatch({ type: 'matchFailed', id: next.id, signature, error: message });
      })
      .finally(() => {
        if (running.current === job) running.current = null;
        setTick((n) => n + 1);
      });
  }, [tracks, settings.autoMatch, settings.country, settings.explicitPreference, service, dispatch, tick]);

  // Cancel any in-flight lookup when the app unmounts.
  useEffect(() => () => running.current?.controller.abort(), []);

  /** Look this track up next, even when automatic matching is paused. */
  const prioritize = useCallback(
    (id: string) => {
      priority.current = [id, ...priority.current.filter((p) => p !== id)];
      dispatch({ type: 'requeue', ids: [id] });
    },
    [dispatch],
  );

  const outstanding = tracks.filter((t) => t.match.phase === 'queued' || t.match.phase === 'searching').length;
  const status: MatcherStatus = {
    outstanding,
    running: tracks.some((t) => t.match.phase === 'searching'),
    pausedUntil: limiter.pausedUntil,
    pauseReason: limiter.pauseReason,
  };
  return { status, prioritize };
}
