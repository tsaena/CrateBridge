import { memo } from 'react';
import { AlertTriangle, ChevronDown, Copy, Layers } from 'lucide-react';
import type { PurchaseStatus, Track, WorkspaceSettings } from '../types';
import { formatDuration } from '../lib/normalize';
import { listingKind, matchClass } from '../state/selectors';
import { selectedCandidate } from '../state/workspace';
import { Artwork } from './Artwork';
import { ListingLink } from './ListingLink';
import { MatchBadge } from './MatchBadge';
import { SearchMenu } from './SearchLinks';
import { StatusControl } from './StatusControl';
import { TrackDetails } from './TrackDetails';
import { cx } from './cx';

export interface TrackRowHandlers {
  onActivate: (id: string) => void;
  onToggle: (id: string) => void;
  onStatus: (id: string, status: PurchaseStatus) => void;
  onSelectCandidate: (id: string, candidateId: string) => void;
  onUpdate: (id: string, changes: Partial<Pick<Track, 'artist' | 'title' | 'album' | 'searchOverride'>>) => void;
  onSearchAgain: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenListing: (id: string) => void;
}

interface Props extends TrackRowHandlers {
  track: Track;
  position: number;
  settings: WorkspaceSettings;
  active: boolean;
  expanded: boolean;
  duplicate: boolean;
  alternateVersion: boolean;
}

export const TrackRow = memo(function TrackRow(props: Props) {
  const { track, position, settings, active, expanded, duplicate, alternateVersion } = props;
  const candidate = selectedCandidate(track);
  const recording = candidate?.recording;
  const cls = matchClass(track);
  const label = `${track.artist || 'Unknown artist'} – ${track.title}`;
  const done = track.status === 'purchased' || track.status === 'skipped';
  const kind = listingKind(candidate);
  const detailsId = `details-${track.id}`;

  return (
    <li
      data-track-id={track.id}
      aria-current={active ? 'true' : undefined}
      className={cx(
        'scroll-mt-40 rounded-xl border transition-colors',
        active ? 'border-cue-500/50 bg-ink-800 shadow-[0_0_0_1px_rgb(255_122_69/0.15)]' : 'border-ink-700/80 bg-ink-850/80',
        done && !active && 'opacity-60 hover:opacity-100',
      )}
      onClick={() => props.onActivate(track.id)}
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 p-3 xl:grid-cols-[2rem_auto_minmax(0,1.3fr)_minmax(0,1fr)_auto] xl:items-center xl:gap-x-4">
        <span className="hidden text-right font-mono text-xs text-ink-500 tabular-nums xl:block">{position}</span>
        <Artwork src={recording?.artworkUrl} alt="" />

        <div className="min-w-0">
          <p className={cx('truncate font-medium', track.status === 'purchased' ? 'text-ink-300' : 'text-ink-100')}>
            {track.title || <em className="text-review-300">Missing title</em>}
          </p>
          <p className="truncate text-sm text-ink-300">{track.artist || <em className="text-review-300">Missing artist</em>}</p>
          {(track.parseWarning || duplicate || alternateVersion) && (
            <div className="mt-1 flex flex-wrap gap-1">
              {track.parseWarning && (
                <span className="chip border-review-400/30 text-review-300" title={track.parseWarning}>
                  <AlertTriangle aria-hidden className="size-3" />
                  Check import
                </span>
              )}
              {duplicate && (
                <span className="chip border-nomatch-400/30 text-nomatch-400" title="Same artist, title, and version as another track">
                  <Copy aria-hidden className="size-3" />
                  Duplicate
                </span>
              )}
              {!duplicate && alternateVersion && (
                <span className="chip border-info-400/30 text-info-400" title="Another version of this song is also in the list">
                  <Layers aria-hidden className="size-3" />
                  Other version listed
                </span>
              )}
            </div>
          )}
        </div>

        <div className="col-span-2 min-w-0 xl:col-span-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <MatchBadge match={cls} searching={track.match.phase === 'searching'} />
            {recording && (cls === 'review' || cls === 'none') && (
              <span className="text-xs text-ink-400">{track.match.candidates.length} found</span>
            )}
          </div>
          {recording ? (
            <p className="mt-1 truncate text-xs text-ink-400" title={`${recording.artist} – ${recording.title} · ${recording.album ?? ''}`}>
              <span className="text-ink-200">{recording.title}</span>
              {recording.artist !== track.artist && <> · {recording.artist}</>}
              {recording.album && <> · {recording.album}</>} ·{' '}
              <span className="font-mono tabular-nums">{formatDuration(recording.durationMs)}</span>
              {recording.explicitness === 'explicit' && <> · Explicit</>}
              {recording.explicitness === 'clean' && <> · Clean</>}
            </p>
          ) : (
            track.match.phase === 'done' && <p className="mt-1 text-xs text-ink-400">Use Search to look elsewhere.</p>
          )}
        </div>

        <div className="col-span-2 flex flex-wrap items-center gap-2 xl:col-span-1 xl:justify-end">
          <ListingLink candidate={candidate} trackLabel={label} onOpen={() => props.onOpenListing(track.id)} />
          {kind === 'none' && track.match.phase === 'done' && (
            <span className="text-xs text-ink-400">No store listing found</span>
          )}
          <SearchMenu
            track={track}
            country={settings.country}
            modifiers={settings.searchModifiers}
            onFindInCatalog={() => {
              if (!expanded) props.onToggle(track.id);
            }}
          />
          <button
            type="button"
            className="btn btn-ghost px-2 py-1.5 text-xs"
            aria-expanded={expanded}
            aria-controls={detailsId}
            onClick={(e) => {
              e.stopPropagation();
              props.onToggle(track.id);
            }}
          >
            Versions
            {track.match.candidates.length > 0 && (
              <span className="rounded bg-ink-700 px-1 font-mono text-[10px] text-ink-200">{track.match.candidates.length}</span>
            )}
            <ChevronDown aria-hidden className={cx('size-3.5 transition-transform', expanded && 'rotate-180')} />
          </button>
          <StatusControl
            value={track.status}
            onChange={(status) => props.onStatus(track.id, status)}
            trackLabel={label}
            compact
          />
        </div>
      </div>

      {expanded && (
        <div id={detailsId} onClick={(e) => e.stopPropagation()}>
          <TrackDetails
            track={track}
            settings={settings}
            onSelect={(candidateId) => props.onSelectCandidate(track.id, candidateId)}
            onUpdate={(changes) => props.onUpdate(track.id, changes)}
            onSearchAgain={() => props.onSearchAgain(track.id)}
            onDelete={() => props.onDelete(track.id)}
            onOpenListing={() => props.onOpenListing(track.id)}
          />
        </div>
      )}
    </li>
  );
});
