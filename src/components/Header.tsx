import { Download, Keyboard, Settings2 } from 'lucide-react';
import { cx } from './cx';

interface Props {
  purchased: number;
  total: number;
  settingsOpen: boolean;
  onToggleSettings: () => void;
  onExport?: () => void;
  onShowShortcuts?: () => void;
}

export function Header({ purchased, total, settingsOpen, onToggleSettings, onExport, onShowShortcuts }: Props) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <Logo />
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink-100 sm:text-2xl">CrateBridge</h1>
          <p className="text-sm text-ink-400">From playlists to your permanent collection</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {total > 0 && (
          <p className="mr-1 rounded-full border border-ink-700 bg-ink-850 px-3 py-1 text-xs text-ink-300">
            <span className="font-mono text-verified-400 tabular-nums">{purchased}</span>
            <span className="text-ink-500"> / </span>
            <span className="font-mono tabular-nums">{total}</span> purchased
          </p>
        )}
        {onShowShortcuts && (
          <button type="button" className="btn btn-ghost hidden px-2.5 sm:inline-flex" onClick={onShowShortcuts}>
            <Keyboard aria-hidden className="size-4" />
            <span className="sr-only xl:not-sr-only">Shortcuts</span>
          </button>
        )}
        {onExport && (
          <button type="button" className="btn btn-ghost px-2.5" onClick={onExport}>
            <Download aria-hidden className="size-4" />
            <span className="sr-only sm:not-sr-only">Export CSV</span>
          </button>
        )}
        <button
          type="button"
          className={cx('btn px-2.5', settingsOpen ? 'btn-secondary' : 'btn-ghost')}
          aria-expanded={settingsOpen}
          onClick={onToggleSettings}
        >
          <Settings2 aria-hidden className="size-4" />
          <span className="sr-only sm:not-sr-only">Settings</span>
        </button>
      </div>
    </header>
  );
}

function Logo() {
  return (
    <svg viewBox="0 0 40 40" className="size-10 shrink-0" aria-hidden>
      <defs>
        <radialGradient id="cb-groove" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#1c2026" />
          <stop offset="100%" stopColor="#0d0f12" />
        </radialGradient>
      </defs>
      <circle cx="20" cy="20" r="19" fill="url(#cb-groove)" stroke="#323843" />
      <circle cx="20" cy="20" r="14" fill="none" stroke="#252a32" />
      <circle cx="20" cy="20" r="10.5" fill="none" stroke="#252a32" />
      <circle cx="20" cy="20" r="6" fill="#ff7a45" />
      <circle cx="20" cy="20" r="1.6" fill="#0d0f12" />
      <path d="M31 9 L35 5" stroke="#ff9466" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
