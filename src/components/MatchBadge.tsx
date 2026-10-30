import { AlertTriangle, CheckCircle2, CircleSlash, Loader2, UserCheck, WifiOff } from 'lucide-react';
import type { MatchClass } from '../state/selectors';
import { cx } from './cx';

const CONFIG: Record<MatchClass, { label: string; className: string; Icon: typeof CheckCircle2; hint: string }> = {
  high: {
    label: 'High confidence',
    className: 'border-verified-500/40 bg-verified-500/10 text-verified-400',
    Icon: CheckCircle2,
    hint: 'Artist, title, and version all agree with the catalog listing.',
  },
  confirmed: {
    label: 'Your pick',
    className: 'border-info-400/40 bg-info-400/10 text-info-400',
    Icon: UserCheck,
    hint: 'You selected this version.',
  },
  review: {
    label: 'Review suggested',
    className: 'border-review-400/40 bg-review-400/10 text-review-300',
    Icon: AlertTriangle,
    hint: 'A plausible match exists, but something differs. Compare versions before buying.',
  },
  none: {
    label: 'No reliable match',
    className: 'border-nomatch-400/40 bg-nomatch-400/10 text-nomatch-400',
    Icon: CircleSlash,
    hint: 'The catalog results don’t clearly match this track. Try another search.',
  },
  pending: {
    label: 'Searching…',
    className: 'border-ink-600 bg-ink-800 text-ink-300',
    Icon: Loader2,
    hint: 'Waiting for a catalog lookup.',
  },
  error: {
    label: 'Lookup failed',
    className: 'border-nomatch-400/40 bg-ink-800 text-nomatch-400',
    Icon: WifiOff,
    hint: 'The catalog couldn’t be reached. External search links still work.',
  },
};

export function MatchBadge({ match, searching }: { match: MatchClass; searching?: boolean }) {
  const { label, className, Icon, hint } = CONFIG[match];
  const text = match === 'pending' && !searching ? 'Queued' : label;
  return (
    <span className={cx('chip', className)} title={hint}>
      <Icon aria-hidden className={cx('size-3', match === 'pending' && searching && 'animate-spin')} />
      {text}
    </span>
  );
}
