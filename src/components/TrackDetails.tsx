import { useState, type FormEvent } from 'react';
import { Check, Info, Minus, Plus, RotateCcw, Search, Trash2 } from 'lucide-react';
import type { RankedCandidate, Track, WorkspaceSettings } from '../types';
import { analyzeTitle, formatDuration, VERSION_LABELS } from '../lib/normalize';
import { catalogQueries } from '../lib/matching/matchTrack';
import { isPurchasable } from '../lib/matching/rank';
import { formatPrice } from '../state/selectors';
import { selectedCandidate } from '../state/workspace';
import { Artwork } from './Artwork';
import { ListingLink } from './ListingLink';
import { MatchBadge } from './MatchBadge';
import { ExternalSearchList } from './SearchLinks';
import { cx } from './cx';

interface Props {
  track: Track;
  settings: WorkspaceSettings;
  onSelect: (candidateId: string) => void;
  onUpdate: (changes: Partial<Pick<Track, 'artist' | 'title' | 'album' | 'searchOverride'>>) => void;
  onSearchAgain: () => void;
  onDelete: () => void;
  onOpenListing: () => void;
}

export function TrackDetails({ track, settings, onSelect, onUpdate, onSearchAgain, onDelete, onOpenListing }: Props) {
  const selected = selectedCandidate(track);
  const { phase, candidates, error } = track.match;
  const label = `${track.artist} – ${track.title}`;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 rounded-b-xl border-t border-ink-700/80 bg-ink-900/50 px-3 py-4 sm:px-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section aria-label={`Catalog versions for ${label}`} className="min-w-0">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-ink-100">Versions in the iTunes Store ({settings.country})</h3>
          {phase === 'done' && track.match.searchedAt && (
            <button type="button" className="btn btn-ghost px-2 py-1 text-xs" onClick={onSearchAgain}>
              <RotateCcw aria-hidden className="size-3.5" />
              Search again
            </button>
          )}
        </div>

        {(phase === 'queued' || phase === 'searching' || phase === 'idle') && (
          <p className="rounded-lg border border-ink-700 bg-ink-850 px-3 py-3 text-sm text-ink-300">
            {phase === 'searching' ? 'Searching Apple’s catalog…' : 'Waiting in the lookup queue.'}{' '}
            {phase !== 'searching' && (
              <button type="button" className="font-medium text-cue-400 underline-offset-2 hover:underline" onClick={onSearchAgain}>
                Look this one up next
              </button>
            )}
          </p>
        )}

        {phase === 'error' && (
          <div className="rounded-lg border border-nomatch-400/30 bg-nomatch-400/5 px-3 py-3 text-sm">
            <p className="text-nomatch-400">{error ?? 'The catalog lookup failed.'}</p>
            <p className="mt-1 text-ink-300">The search links on the right still work without the catalog.</p>
            <button type="button" className="btn btn-secondary mt-2 px-2.5 py-1.5 text-xs" onClick={onSearchAgain}>
              <RotateCcw aria-hidden className="size-3.5" />
              Retry lookup
            </button>
          </div>
        )}

        {phase === 'done' && candidates.length === 0 && (
          <p className="rounded-lg border border-ink-700 bg-ink-850 px-3 py-3 text-sm text-ink-300">
            No songs found in the {settings.country} iTunes catalog for this search. Check the spelling, refine the search, or try
            another store.
          </p>
        )}

        {phase === 'done' && candidates.length > 0 && (
          <ul className="grid gap-2" aria-label="Candidate recordings">
            {candidates.map((candidate) => (
              <CandidateRow
                key={candidate.recording.id}
                candidate={candidate}
                selected={candidate.recording.id === selected?.recording.id}
                onSelect={() => onSelect(candidate.recording.id)}
                onOpenListing={onOpenListing}
              />
            ))}
          </ul>
        )}

        <p className="mt-3 flex gap-2 text-xs leading-5 text-ink-400">
          <Info aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>
            <strong className="font-medium text-ink-300">iTunes listing</strong> links open the iTunes Store page for that exact
            recording, where you complete the purchase. On a Mac they open the Music app; turn on iTunes Store in Music → Settings →
            General if it’s hidden. Without Apple’s apps, the link falls back to Apple Music on the web, which doesn’t sell tracks.
          </span>
        </p>
      </section>

      <aside className="grid min-w-0 content-start gap-5">
        <RefineSearch track={track} onSubmit={(searchOverride) => onUpdate({ searchOverride })} />
        <section>
          <h3 className="mb-1 text-sm font-semibold text-ink-100">Search other stores</h3>
          {settings.searchModifiers.length > 0 && (
            <p className="mb-1 text-xs text-ink-400">Adding: {settings.searchModifiers.join(', ')}</p>
          )}
          <ExternalSearchList track={track} country={settings.country} modifiers={settings.searchModifiers} />
        </section>
        <EditTrack track={track} onSave={onUpdate} onDelete={onDelete} />
      </aside>
    </div>
  );
}

function CandidateRow({
  candidate,
  selected,
  onSelect,
  onOpenListing,
}: {
  candidate: RankedCandidate;
  selected: boolean;
  onSelect: () => void;
  onOpenListing: () => void;
}) {
  const { recording, reasons, confidence } = candidate;
  const tags = analyzeTitle(recording.title).tags.filter((t) => t !== 'clean' && t !== 'explicit');
  const label = `${recording.artist} – ${recording.title}`;
  const year = recording.releaseDate?.slice(0, 4);

  return (
    <li
      className={cx(
        'rounded-xl border p-3 transition-colors',
        selected ? 'border-cue-500/60 bg-cue-500/5' : 'border-ink-700 bg-ink-850 hover:border-ink-600',
      )}
    >
      <div className="flex flex-wrap items-start gap-3 sm:flex-nowrap">
        <Artwork src={recording.artworkUrl} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-ink-100">{recording.title}</p>
          <p className="text-sm text-ink-300">{recording.artist}</p>
          <p className="mt-0.5 text-xs text-ink-400">
            {recording.album ?? 'Unknown album'}
            {year && ` · ${year}`} · <span className="font-mono tabular-nums">{formatDuration(recording.durationMs)}</span>
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            <MatchBadge match={confidence} />
            {recording.explicitness === 'explicit' && <span className="chip border-ink-600 text-ink-200">Explicit</span>}
            {recording.explicitness === 'clean' && <span className="chip border-ink-600 text-ink-200">Clean</span>}
            {tags.map((t) => (
              <span key={t} className="chip border-ink-600 text-ink-300">
                {VERSION_LABELS[t]}
              </span>
            ))}
          </div>
        </div>
        <div className="flex w-full flex-row flex-wrap items-center gap-2 sm:w-auto sm:flex-col sm:items-end">
          <span className="font-mono text-sm text-ink-100 tabular-nums">
            {isPurchasable(recording) && recording.currency ? (
              formatPrice(recording.price!, recording.currency)
            ) : (
              <span className="text-xs text-review-300">No track price</span>
            )}
          </span>
          <button
            type="button"
            aria-pressed={selected}
            aria-label={selected ? `Selected: ${label}` : `Use this version: ${label}`}
            onClick={onSelect}
            className={cx('btn px-2.5 py-1.5 text-xs', selected ? 'btn-primary' : 'btn-secondary')}
          >
            {selected ? <Check aria-hidden className="size-3.5" /> : null}
            {selected ? 'Selected' : 'Use this version'}
          </button>
          <ListingLink candidate={candidate} trackLabel={label} onOpen={onOpenListing} size="sm" />
        </div>
      </div>
      <details className="mt-2" open={selected}>
        <summary className="text-xs text-ink-400 hover:text-ink-200">Why this rating?</summary>
        <ul className="mt-1.5 grid gap-0.5 text-xs">
          {reasons.map((reason, i) => (
            <li key={i} className="flex items-start gap-1.5">
              {reason.effect === 'plus' ? (
                <Plus aria-label="supports" className="mt-0.5 size-3 shrink-0 text-verified-400" />
              ) : reason.effect === 'minus' ? (
                <Minus aria-label="counts against" className="mt-0.5 size-3 shrink-0 text-nomatch-400" />
              ) : (
                <Info aria-label="note" className="mt-0.5 size-3 shrink-0 text-ink-400" />
              )}
              <span className="text-ink-300">{reason.text}</span>
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}

function RefineSearch({ track, onSubmit }: { track: Track; onSubmit: (override: string) => void }) {
  const automatic = catalogQueries({ ...track, searchOverride: undefined })[0] ?? '';
  const [value, setValue] = useState(track.searchOverride ?? automatic);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    onSubmit(trimmed === automatic ? '' : trimmed);
  };

  return (
    <form onSubmit={submit}>
      <label className="mb-1 block text-sm font-semibold text-ink-100" htmlFor={`refine-${track.id}`}>
        Refine catalog search
      </label>
      <div className="flex gap-2">
        <input id={`refine-${track.id}`} className="field py-1.5" value={value} onChange={(e) => setValue(e.target.value)} />
        <button type="submit" className="btn btn-secondary px-2.5 py-1.5 text-xs" aria-label="Search the iTunes catalog">
          <Search aria-hidden className="size-3.5" />
        </button>
      </div>
      {track.searchOverride && (
        <button
          type="button"
          className="mt-1 text-xs text-ink-400 underline-offset-2 hover:text-ink-200 hover:underline"
          onClick={() => {
            setValue(automatic);
            onSubmit('');
          }}
        >
          Reset to automatic search
        </button>
      )}
    </form>
  );
}

function EditTrack({
  track,
  onSave,
  onDelete,
}: {
  track: Track;
  onSave: (changes: Pick<Track, 'artist' | 'title' | 'album'>) => void;
  onDelete: () => void;
}) {
  const [artist, setArtist] = useState(track.artist);
  const [title, setTitle] = useState(track.title);
  const [album, setAlbum] = useState(track.album ?? '');
  const dirty = artist !== track.artist || title !== track.title || album !== (track.album ?? '');

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim()) onSave({ artist, title, album: album || undefined });
      }}
      className="grid gap-2"
    >
      <h3 className="text-sm font-semibold text-ink-100">Edit track</h3>
      <label className="grid gap-1 text-xs text-ink-300">
        Artist
        <input className="field py-1.5" value={artist} onChange={(e) => setArtist(e.target.value)} />
      </label>
      <label className="grid gap-1 text-xs text-ink-300">
        Title
        <input className="field py-1.5" value={title} onChange={(e) => setTitle(e.target.value)} required />
      </label>
      <label className="grid gap-1 text-xs text-ink-300">
        Album (optional)
        <input className="field py-1.5" value={album} onChange={(e) => setAlbum(e.target.value)} />
      </label>
      <div className="flex items-center justify-between gap-2">
        <button type="submit" className="btn btn-secondary px-2.5 py-1.5 text-xs" disabled={!dirty || !title.trim()}>
          Save and re-match
        </button>
        <button type="button" className="btn btn-ghost px-2.5 py-1.5 text-xs text-nomatch-400 hover:text-nomatch-400" onClick={onDelete}>
          <Trash2 aria-hidden className="size-3.5" />
          Remove track
        </button>
      </div>
    </form>
  );
}
