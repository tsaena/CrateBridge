import { useState } from 'react';
import { Copy } from 'lucide-react';
import type { DuplicateGroup } from '../lib/duplicates';

interface Props {
  groups: DuplicateGroup[];
  onRemove: (ids: string[]) => void;
}

/** Duplicates are only removed after an explicit, two-step confirmation. */
export function DuplicatesBanner({ groups, onRemove }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [showList, setShowList] = useState(false);
  const removable = groups.flatMap((g) => g.remove);
  if (removable.length === 0) return null;

  return (
    <div className="rounded-xl border border-nomatch-400/30 bg-nomatch-400/5 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-ink-200">
          <Copy aria-hidden className="size-4 text-nomatch-400" />
          {removable.length} likely {removable.length === 1 ? 'duplicate' : 'duplicates'} (same artist, title, and version).
          Different versions such as remixes are kept.
        </p>
        <div className="flex gap-2">
          <button type="button" className="btn btn-ghost px-2.5 py-1.5 text-xs" onClick={() => setShowList((v) => !v)} aria-expanded={showList}>
            {showList ? 'Hide' : 'Review'}
          </button>
          {confirming ? (
            <>
              <button
                type="button"
                className="btn btn-danger px-2.5 py-1.5 text-xs"
                onClick={() => {
                  onRemove(removable.map((t) => t.id));
                  setConfirming(false);
                }}
              >
                Confirm: remove {removable.length}
              </button>
              <button type="button" className="btn btn-ghost px-2.5 py-1.5 text-xs" onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-secondary px-2.5 py-1.5 text-xs" onClick={() => setConfirming(true)}>
              Remove duplicates…
            </button>
          )}
        </div>
      </div>
      {showList && (
        <ul className="mt-2 grid gap-1 text-xs text-ink-300">
          {groups.map((g) => (
            <li key={g.key}>
              Keeping <span className="text-ink-100">{g.keep.artist} – {g.keep.title}</span>; removing {g.remove.length}{' '}
              {g.remove.length === 1 ? 'copy' : 'copies'}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
