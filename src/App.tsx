import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ListPlus, RotateCcw, Trash2, X } from 'lucide-react';
import type { PurchaseStatus, TrackDraft, TrackSource } from './types';
import { CatalogSearchService } from './lib/catalog/searchService';
import { createItunesProvider } from './lib/providers/itunes';
import { findAlternateVersions, findDuplicates } from './lib/duplicates';
import { usePersistentWorkspace } from './hooks/usePersistentWorkspace';
import { useMatcher } from './hooks/useMatcher';
import { clearStoredWorkspace, type StorageLike } from './state/storage';
import { selectedCandidate } from './state/workspace';
import {
  DEFAULT_VIEW,
  exportChecklistCsv,
  filterAndSort,
  summarize,
  type StatusFilter,
  type ViewOptions,
} from './state/selectors';
import { Header } from './components/Header';
import { ImportPanel } from './components/ImportPanel';
import { SummaryBar } from './components/SummaryBar';
import { Toolbar } from './components/Toolbar';
import { TrackRow, type TrackRowHandlers } from './components/TrackRow';
import { DuplicatesBanner } from './components/DuplicatesBanner';
import { SettingsPanel } from './components/SettingsPanel';
import { Toast, type ToastMessage } from './components/Toast';
import { ReturnPrompt } from './components/ReturnPrompt';
import { ShortcutHelp } from './components/ShortcutHelp';
import { cx } from './components/cx';

interface AppProps {
  /** Injected in tests; defaults to the live iTunes Search API. */
  service?: CatalogSearchService;
  storage?: StorageLike;
}

export default function App({ service: injectedService, storage }: AppProps) {
  const [service] = useState(() => injectedService ?? new CatalogSearchService(createItunesProvider()));
  const { workspace, dispatch, persistence, dismissRecovery } = usePersistentWorkspace(storage);
  const { status: matcher, prioritize } = useMatcher(workspace, dispatch, service);
  const { tracks, settings } = workspace;

  const [view, setView] = useState<ViewOptions>(DEFAULT_VIEW);
  const [activeId, setActiveId] = useState<string>();
  const [expandedId, setExpandedId] = useState<string>();
  const [importOpen, setImportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [toast, setToast] = useState<ToastMessage>();
  const [returnTrackId, setReturnTrackId] = useState<string>();
  const [confirm, setConfirm] = useState<'clear' | 'reset'>();
  const [now, setNow] = useState(() => Date.now());
  const openedListing = useRef<{ id: string; at: number }>(undefined);

  const summary = useMemo(() => summarize(tracks), [tracks]);
  const visible = useMemo(() => filterAndSort(tracks, view), [tracks, view]);
  const duplicateGroups = useMemo(() => findDuplicates(tracks), [tracks]);
  const duplicateIds = useMemo(() => new Set(duplicateGroups.flatMap((g) => g.remove.map((t) => t.id))), [duplicateGroups]);
  const alternateIds = useMemo(() => findAlternateVersions(tracks), [tracks]);
  const statusCounts = useMemo(() => {
    const counts: Record<StatusFilter, number> = { all: tracks.length, remaining: summary.remaining, not_started: 0, found: 0, purchased: 0, skipped: 0 };
    tracks.forEach((t) => (counts[t.status] += 1));
    return counts;
  }, [tracks, summary.remaining]);

  // Tick once a second only while a rate-limit countdown is showing.
  useEffect(() => {
    if (matcher.pausedUntil <= Date.now()) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [matcher.pausedUntil]);

  const showToast = useCallback((message: Omit<ToastMessage, 'id'>) => setToast({ ...message, id: Date.now() }), []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(undefined), toast.onAction ? 8000 : 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  // --- Track actions -------------------------------------------------------

  // Latest values for event handlers that shouldn't re-subscribe on every change.
  const tracksRef = useRef(tracks);
  const visibleRef = useRef(visible);
  useEffect(() => {
    tracksRef.current = tracks;
    visibleRef.current = visible;
  }, [tracks, visible]);

  const removeTracks = useCallback(
    (ids: string[], label: string) => {
      const current = tracksRef.current;
      const entries = current.flatMap((track, index) => (ids.includes(track.id) ? [{ track, index }] : []));
      if (entries.length === 0) return;
      dispatch({ type: 'delete', ids });
      showToast({ text: label, actionLabel: 'Undo', onAction: () => dispatch({ type: 'restore', entries }) });
    },
    [dispatch, showToast],
  );

  /** Move to the next track that still needs attention, in the current view order. */
  const advanceFrom = useCallback((id: string) => {
    const list = visibleRef.current;
    const index = list.findIndex((t) => t.id === id);
    const next =
      list.slice(index + 1).find((t) => t.status === 'not_started' || t.status === 'found') ?? list[index + 1];
    if (next) {
      setActiveId(next.id);
      scrollToTrack(next.id);
    }
  }, []);

  const handlers: TrackRowHandlers = useMemo(
    () => ({
      onActivate: (id) => setActiveId(id),
      onToggle: (id) => {
        setActiveId(id);
        setExpandedId((current) => (current === id ? undefined : id));
      },
      onStatus: (id, status) => dispatch({ type: 'setStatus', ids: [id], status }),
      onSelectCandidate: (id, candidateId) => dispatch({ type: 'selectCandidate', id, candidateId }),
      onUpdate: (id, changes) => {
        dispatch({ type: 'update', id, changes });
        prioritize(id);
      },
      onSearchAgain: (id) => prioritize(id),
      onDelete: (id) => {
        const track = tracksRef.current.find((t) => t.id === id);
        removeTracks([id], `Removed “${track?.title ?? 'track'}”`);
      },
      onOpenListing: (id) => {
        setActiveId(id);
        openedListing.current = { id, at: Date.now() };
      },
    }),
    [dispatch, prioritize, removeTracks],
  );

  const setStatusAndAdvance = useCallback(
    (id: string, status: PurchaseStatus) => {
      dispatch({ type: 'setStatus', ids: [id], status });
      if (status === 'purchased' || status === 'skipped') advanceFrom(id);
    },
    [dispatch, advanceFrom],
  );

  // --- Return-from-store prompt -------------------------------------------

  useEffect(() => {
    const onReturn = () => {
      const opened = openedListing.current;
      if (!opened || document.visibilityState === 'hidden') return;
      if (Date.now() - opened.at < 1500) return;
      openedListing.current = undefined;
      const track = tracksRef.current.find((t) => t.id === opened.id);
      if (track && track.status !== 'purchased') setReturnTrackId(opened.id);
    };
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
    return () => {
      window.removeEventListener('focus', onReturn);
      document.removeEventListener('visibilitychange', onReturn);
    };
  }, []);

  const returnTrack = returnTrackId ? tracks.find((t) => t.id === returnTrackId) : undefined;

  // --- Keyboard shortcuts --------------------------------------------------

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      // Leave Enter alone on buttons and links so they keep working.
      if (event.key === 'Enter' && target && /^(BUTTON|A|SUMMARY)$/.test(target.tagName)) return;

      const list = visibleRef.current;
      const index = list.findIndex((t) => t.id === activeId);
      const active = index >= 0 ? list[index] : undefined;
      const move = (delta: number) => {
        const next = list[Math.min(Math.max(index + delta, 0), list.length - 1)];
        if (next) {
          setActiveId(next.id);
          scrollToTrack(next.id);
        }
      };

      switch (event.key) {
        case 'j':
          move(1);
          break;
        case 'k':
          move(-1);
          break;
        case '/':
          document.querySelector<HTMLInputElement>('[data-shortcut-target="filter"]')?.focus();
          break;
        case '?':
          setHelpOpen((v) => !v);
          break;
        case 'o':
        case 'Enter': {
          const url = active && selectedCandidate(active)?.recording.listingUrl;
          if (!active || !url) return;
          window.open(url, '_blank', 'noopener,noreferrer');
          openedListing.current = { id: active.id, at: Date.now() };
          break;
        }
        case 'p':
          if (!active) return;
          setStatusAndAdvance(active.id, 'purchased');
          break;
        case 's':
          if (!active) return;
          setStatusAndAdvance(active.id, 'skipped');
          break;
        case 'f':
          if (!active) return;
          dispatch({ type: 'setStatus', ids: [active.id], status: 'found' });
          break;
        case 'n':
          if (!active) return;
          dispatch({ type: 'setStatus', ids: [active.id], status: 'not_started' });
          break;
        case 'v':
          if (!active) return;
          setExpandedId((current) => (current === active.id ? undefined : active.id));
          break;
        default:
          return;
      }
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeId, dispatch, setStatusAndAdvance]);

  // --- Workspace actions ---------------------------------------------------

  const importDrafts = (drafts: TrackDraft[], source: TrackSource) => {
    const count = drafts.filter((d) => d.title.trim() || d.artist.trim()).length;
    if (count === 0) return;
    dispatch({ type: 'import', drafts, source });
    setImportOpen(false);
    showToast({ text: `Imported ${count} ${count === 1 ? 'track' : 'tracks'}. Matching against the iTunes catalog…` });
  };

  const exportCsv = () => {
    const blob = new Blob([exportChecklistCsv(tracks)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `cratebridge-checklist-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const failedCount = tracks.filter((t) => t.match.phase === 'error').length;
  const hasTracks = tracks.length > 0;

  return (
    <div className="mx-auto flex min-h-screen max-w-[1400px] flex-col gap-5 px-4 py-5 sm:px-6 sm:py-7">
      <Header
        purchased={summary.purchased}
        total={summary.total}
        settingsOpen={settingsOpen}
        onToggleSettings={() => setSettingsOpen((v) => !v)}
        onExport={hasTracks ? exportCsv : undefined}
        onShowShortcuts={hasTracks ? () => setHelpOpen((v) => !v) : undefined}
      />

      {persistence.recoveryMessage && (
        <Notice tone="warning" onDismiss={dismissRecovery}>
          {persistence.recoveryMessage}
        </Notice>
      )}
      {persistence.saveError && <Notice tone="error">{persistence.saveError}</Notice>}

      {settingsOpen && <SettingsPanel settings={settings} onChange={(changes) => dispatch({ type: 'updateSettings', changes })} />}
      {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}

      {!hasTracks ? (
        <EmptyState onImport={importDrafts} />
      ) : (
        <>
          <SummaryBar
            summary={summary}
            matcher={matcher}
            autoMatch={settings.autoMatch}
            onToggleAutoMatch={() => dispatch({ type: 'updateSettings', changes: { autoMatch: !settings.autoMatch } })}
            now={now}
          />

          <section className="panel">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left sm:px-5"
              aria-expanded={importOpen}
              onClick={() => setImportOpen((v) => !v)}
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-ink-100">
                <ListPlus aria-hidden className="size-4 text-cue-400" />
                Add more tracks
              </span>
              <ChevronDown aria-hidden className={cx('size-4 text-ink-400 transition-transform', importOpen && 'rotate-180')} />
            </button>
            {importOpen && (
              <div className="border-t border-ink-700/80 px-4 py-4 sm:px-5">
                <ImportPanel onImport={importDrafts} hasTracks />
              </div>
            )}
          </section>

          <section aria-label="Playlist workspace" className="grid gap-3">
            <div className="z-20 -mx-4 bg-ink-950/90 px-4 pt-2 pb-3 backdrop-blur sm:sticky sm:top-0 sm:-mx-6 sm:px-6">
              <Toolbar view={view} onChange={setView} counts={statusCounts} shown={visible.length} />
            </div>

            <DuplicatesBanner
              groups={duplicateGroups}
              onRemove={(ids) => removeTracks(ids, `Removed ${ids.length} ${ids.length === 1 ? 'duplicate' : 'duplicates'}`)}
            />

            {visible.length === 0 ? (
              <p className="rounded-xl border border-dashed border-ink-700 px-4 py-10 text-center text-sm text-ink-400">
                No tracks match these filters.{' '}
                <button type="button" className="text-cue-400 hover:underline" onClick={() => setView(DEFAULT_VIEW)}>
                  Clear filters
                </button>
              </p>
            ) : (
              <ol className="grid gap-2" aria-label="Tracks">
                {visible.map((track) => (
                  <TrackRow
                    key={track.id}
                    track={track}
                    position={tracks.indexOf(track) + 1}
                    settings={settings}
                    active={track.id === activeId}
                    expanded={track.id === expandedId}
                    duplicate={duplicateIds.has(track.id)}
                    alternateVersion={alternateIds.has(track.id)}
                    {...handlers}
                  />
                ))}
              </ol>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 text-xs text-ink-400">
              <p className="hidden sm:block">
                Tip: press <kbd className="kbd">J</kbd>/<kbd className="kbd">K</kbd> to move, <kbd className="kbd">O</kbd> to open a
                listing, <kbd className="kbd">P</kbd> to mark purchased.
              </p>
              <div className="flex flex-wrap gap-2">
                {failedCount > 0 && (
                  <button type="button" className="btn btn-ghost px-2.5 py-1.5 text-xs" onClick={() => dispatch({ type: 'requeue', onlyFailed: true })}>
                    <RotateCcw aria-hidden className="size-3.5" />
                    Retry {failedCount} failed {failedCount === 1 ? 'lookup' : 'lookups'}
                  </button>
                )}
                {confirm ? (
                  <span className="flex items-center gap-2 rounded-lg border border-nomatch-400/30 bg-nomatch-400/5 px-2 py-1">
                    {confirm === 'clear'
                      ? `Remove all ${tracks.length} tracks from this browser?`
                      : 'Set every track back to Not Started?'}
                    <button
                      type="button"
                      className="btn btn-danger px-2 py-1 text-xs"
                      onClick={() => {
                        if (confirm === 'clear') {
                          dispatch({ type: 'clear' });
                          clearStoredWorkspace(storage);
                          setExpandedId(undefined);
                          setActiveId(undefined);
                        } else {
                          dispatch({ type: 'resetAllStatuses' });
                        }
                        setConfirm(undefined);
                      }}
                    >
                      {confirm === 'clear' ? 'Clear workspace' : 'Reset statuses'}
                    </button>
                    <button type="button" className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setConfirm(undefined)}>
                      Cancel
                    </button>
                  </span>
                ) : (
                  <>
                    <button type="button" className="btn btn-ghost px-2.5 py-1.5 text-xs" onClick={() => setConfirm('reset')}>
                      <RotateCcw aria-hidden className="size-3.5" />
                      Reset all statuses
                    </button>
                    <button type="button" className="btn btn-ghost px-2.5 py-1.5 text-xs hover:text-nomatch-400" onClick={() => setConfirm('clear')}>
                      <Trash2 aria-hidden className="size-3.5" />
                      Clear workspace
                    </button>
                  </>
                )}
              </div>
            </div>
          </section>
        </>
      )}

      <Footer />

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex flex-col items-center gap-2 px-4 pb-4">
        {returnTrack && (
          <ReturnPrompt
            track={returnTrack}
            onPurchased={() => {
              setStatusAndAdvance(returnTrack.id, 'purchased');
              setReturnTrackId(undefined);
            }}
            onFound={() => {
              dispatch({ type: 'setStatus', ids: [returnTrack.id], status: 'found' });
              setReturnTrackId(undefined);
            }}
            onDismiss={() => setReturnTrackId(undefined)}
          />
        )}
        {toast && <Toast key={toast.id} toast={toast} onDismiss={() => setToast(undefined)} />}
      </div>
    </div>
  );
}

function scrollToTrack(id: string) {
  requestAnimationFrame(() => {
    document.querySelector(`[data-track-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
}

function EmptyState({ onImport }: { onImport: (drafts: TrackDraft[], source: TrackSource) => void }) {
  const steps = [
    ['Import', 'Paste a tracklist or upload a playlist CSV.'],
    ['Review', 'CrateBridge finds matching recordings in the iTunes Store and flags anything uncertain.'],
    ['Buy & check off', 'Open each verified listing, buy it from Apple, and mark it purchased.'],
  ];
  return (
    <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="panel p-4 sm:p-6">
        <h2 className="text-lg font-semibold text-ink-100">Start a purchase list</h2>
        <p className="mt-1 mb-5 text-sm text-ink-400">
          Turn a streaming playlist into a checklist of tracks to buy and own — no accounts, no sign-in.
        </p>
        <ImportPanel onImport={onImport} hasTracks={false} />
      </div>
      <ol className="grid content-start gap-3">
        {steps.map(([title, text], i) => (
          <li key={title} className="flex gap-3 rounded-xl border border-ink-700/70 bg-ink-900/40 p-4">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-cue-500/15 font-mono text-sm text-cue-400">
              {i + 1}
            </span>
            <div>
              <p className="text-sm font-medium text-ink-100">{title}</p>
              <p className="text-sm text-ink-400">{text}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Notice({ tone, children, onDismiss }: { tone: 'warning' | 'error'; children: React.ReactNode; onDismiss?: () => void }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx(
        'flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm',
        tone === 'error' ? 'border-nomatch-400/40 bg-nomatch-400/10 text-nomatch-400' : 'border-review-400/40 bg-review-400/10 text-review-300',
      )}
    >
      <span>{children}</span>
      {onDismiss && (
        <button type="button" aria-label="Dismiss" onClick={onDismiss} className="opacity-70 hover:opacity-100">
          <X aria-hidden className="size-4" />
        </button>
      )}
    </div>
  );
}

function Footer() {
  return (
    <footer className="mt-auto border-t border-ink-800 pt-5 pb-16 text-xs leading-5 text-ink-500">
      <p>
        CrateBridge doesn’t sell, stream, or distribute music. Purchases happen entirely on the retailer’s own site or app; CrateBridge
        never handles payments. Not affiliated with Apple, Spotify, Amazon, Beatport, Bandcamp, or any other retailer. Catalog data
        and artwork provided courtesy of iTunes.
      </p>
      <p className="mt-1">
        Your workspace is saved only in this browser’s local storage. It is not backed up or synced, and clearing browser data removes
        it — export a CSV to keep a copy.
      </p>
    </footer>
  );
}

