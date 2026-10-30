import { Search } from 'lucide-react';
import type { MatchFilter, SortKey, StatusFilter, ViewOptions } from '../state/selectors';
import { cx } from './cx';

interface Props {
  view: ViewOptions;
  onChange: (view: ViewOptions) => void;
  counts: Record<StatusFilter, number>;
  shown: number;
}

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'remaining', label: 'Remaining' },
  { id: 'not_started', label: 'Not Started' },
  { id: 'found', label: 'Found' },
  { id: 'purchased', label: 'Purchased' },
  { id: 'skipped', label: 'Skipped' },
];

export function Toolbar({ view, onChange, counts, shown }: Props) {
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 basis-60">
          <span className="sr-only">Filter by artist or title</span>
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-400" />
          <input
            type="search"
            className="field pl-9"
            placeholder="Filter by artist, title, or album"
            value={view.query}
            onChange={(e) => onChange({ ...view, query: e.target.value })}
            data-shortcut-target="filter"
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-ink-400">
          Match
          <select
            className="field w-auto py-2 text-xs"
            value={view.match}
            onChange={(e) => onChange({ ...view, match: e.target.value as MatchFilter })}
          >
            <option value="all">Any</option>
            <option value="likely">Likely matches</option>
            <option value="review">Needs review</option>
            <option value="pending">Still searching</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-ink-400">
          Sort
          <select
            className="field w-auto py-2 text-xs"
            value={view.sort}
            onChange={(e) => onChange({ ...view, sort: e.target.value as SortKey })}
          >
            <option value="order">Playlist order</option>
            <option value="confidence">Needs attention first</option>
            <option value="status">Status</option>
            <option value="artist">Artist</option>
            <option value="title">Title</option>
            <option value="price">Price</option>
          </select>
        </label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={view.status === f.id}
              onClick={() => onChange({ ...view, status: f.id })}
              className={cx(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                view.status === f.id
                  ? 'border-cue-500/60 bg-cue-500/15 text-cue-300'
                  : 'border-ink-700 text-ink-400 hover:border-ink-600 hover:text-ink-200',
              )}
            >
              {f.label} <span className="font-mono tabular-nums opacity-70">{counts[f.id]}</span>
            </button>
          ))}
        </div>
        <p className="text-xs text-ink-400" aria-live="polite">
          Showing {shown}
        </p>
      </div>
    </div>
  );
}
