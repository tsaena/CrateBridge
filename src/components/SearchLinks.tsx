import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ExternalLink, Search } from 'lucide-react';
import type { Track } from '../types';
import { SEARCH_LINK_PROVIDERS, searchTermFor } from '../lib/providers/searchLinks';
import { cx } from './cx';

interface LinksProps {
  track: Track;
  country: string;
  modifiers: string[];
  onNavigate?: () => void;
}

export function ExternalSearchList({ track, country, modifiers, onNavigate }: LinksProps) {
  const term = searchTermFor(track, modifiers);
  return (
    <ul className="grid gap-1">
      {SEARCH_LINK_PROVIDERS.map((provider) => (
        <li key={provider.id}>
          <a
            href={provider.buildUrl(term, country)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onNavigate}
            className="group flex items-start gap-2 rounded-lg px-2.5 py-2 text-sm hover:bg-ink-750 focus-visible:bg-ink-750"
          >
            <ExternalLink aria-hidden className="mt-0.5 size-3.5 shrink-0 text-ink-400 group-hover:text-ink-200" />
            <span className="min-w-0">
              <span className="block text-ink-100">
                {provider.name}
                <span className="sr-only"> search (opens in new tab)</span>
              </span>
              <span className={cx('block text-xs', provider.kind === 'streaming-catalog' ? 'text-review-300' : 'text-ink-400')}>
                {provider.note}
              </span>
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/** Compact "Search" dropdown for the track row. */
export function SearchMenu({ track, country, modifiers, onFindInCatalog }: LinksProps & { onFindInCatalog: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        className="btn btn-secondary px-2.5 py-1.5 text-xs"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <Search aria-hidden className="size-3.5" />
        Search
        <ChevronDown aria-hidden className="size-3.5 text-ink-400" />
      </button>
      {open && (
        <div
          className="absolute right-0 z-30 mt-1 w-72 rounded-xl border border-ink-600 bg-ink-800 p-1.5 shadow-2xl shadow-black/50"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-ink-750"
            onClick={() => {
              setOpen(false);
              onFindInCatalog();
            }}
          >
            <Search aria-hidden className="mt-0.5 size-3.5 shrink-0 text-cue-400" />
            <span>
              <span className="block text-ink-100">Compare iTunes versions</span>
              <span className="block text-xs text-ink-400">Searches Apple’s catalog inside CrateBridge</span>
            </span>
          </button>
          <div className="my-1 border-t border-ink-700" />
          <p className="px-2.5 pt-1 pb-0.5 text-[11px] font-medium tracking-wide text-ink-500 uppercase">
            Search results on other sites
          </p>
          <ExternalSearchList track={track} country={country} modifiers={modifiers} onNavigate={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
