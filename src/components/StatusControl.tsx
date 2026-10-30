import { Check, CircleDashed, Search, SkipForward } from 'lucide-react';
import type { PurchaseStatus } from '../types';
import { STATUS_LABELS } from '../state/selectors';
import { cx } from './cx';

const OPTIONS: { status: PurchaseStatus; Icon: typeof Check; active: string; key: string }[] = [
  { status: 'not_started', Icon: CircleDashed, active: 'bg-ink-600 text-ink-100', key: 'N' },
  { status: 'found', Icon: Search, active: 'bg-info-400/20 text-info-400', key: 'F' },
  { status: 'purchased', Icon: Check, active: 'bg-verified-500/20 text-verified-400', key: 'P' },
  { status: 'skipped', Icon: SkipForward, active: 'bg-ink-600/70 text-ink-300', key: 'S' },
];

interface Props {
  value: PurchaseStatus;
  onChange: (status: PurchaseStatus) => void;
  trackLabel: string;
  compact?: boolean;
}

export function StatusControl({ value, onChange, trackLabel, compact }: Props) {
  return (
    <div role="group" aria-label={`Purchase status for ${trackLabel}`} className="inline-flex rounded-lg border border-ink-700 bg-ink-900 p-0.5">
      {OPTIONS.map(({ status, Icon, active, key }) => {
        const selected = value === status;
        return (
          <button
            key={status}
            type="button"
            aria-pressed={selected}
            title={`${STATUS_LABELS[status]} (${key})`}
            onClick={(event) => {
              event.stopPropagation();
              onChange(status);
            }}
            className={cx(
              'inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
              selected ? active : 'text-ink-400 hover:bg-ink-750 hover:text-ink-200',
            )}
          >
            <Icon aria-hidden className="size-3.5" />
            <span className={cx(compact && !selected && 'sr-only')}>{STATUS_LABELS[status]}</span>
          </button>
        );
      })}
    </div>
  );
}
