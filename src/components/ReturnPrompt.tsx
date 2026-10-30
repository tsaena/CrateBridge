import { Check, Search, X } from 'lucide-react';
import type { Track } from '../types';

interface Props {
  track: Track;
  onPurchased: () => void;
  onFound: () => void;
  onDismiss: () => void;
}

/** Shown when the user comes back after opening a store listing. Never changes status on its own. */
export function ReturnPrompt({ track, onPurchased, onFound, onDismiss }: Props) {
  return (
    <div
      role="dialog"
      aria-label="Update purchase status"
      className="pointer-events-auto flex flex-wrap items-center gap-3 rounded-xl border border-cue-500/40 bg-ink-800 px-4 py-3 text-sm shadow-2xl shadow-black/60"
    >
      <p className="min-w-0 text-ink-200">
        Back from the store — did you buy <span className="font-medium text-ink-100">“{track.title}”</span>?
      </p>
      <div className="flex gap-2">
        <button type="button" className="btn btn-primary px-2.5 py-1.5 text-xs" onClick={onPurchased} autoFocus>
          <Check aria-hidden className="size-3.5" />
          Purchased, next track
        </button>
        <button type="button" className="btn btn-secondary px-2.5 py-1.5 text-xs" onClick={onFound}>
          <Search aria-hidden className="size-3.5" />
          Found, buy later
        </button>
        <button type="button" className="btn btn-ghost px-2 py-1.5 text-xs" onClick={onDismiss} aria-label="Not yet">
          <X aria-hidden className="size-3.5" />
          Not yet
        </button>
      </div>
    </div>
  );
}
