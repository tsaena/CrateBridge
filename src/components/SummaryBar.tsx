import { Pause, Play } from 'lucide-react';
import type { WorkspaceSummary } from '../state/selectors';
import { formatCosts } from '../state/selectors';
import type { MatcherStatus } from '../hooks/useMatcher';
import { DEFAULT_MIN_INTERVAL_MS } from '../lib/catalog/searchService';

interface Props {
  summary: WorkspaceSummary;
  matcher: MatcherStatus;
  autoMatch: boolean;
  onToggleAutoMatch: () => void;
  now: number;
}

export function SummaryBar({ summary, matcher, autoMatch, onToggleAutoMatch, now }: Props) {
  const handled = summary.purchased + summary.skipped;
  const percent = summary.total ? Math.round((handled / summary.total) * 100) : 0;
  const backoffSeconds = Math.max(0, Math.ceil((matcher.pausedUntil - now) / 1000));
  const etaMinutes = Math.ceil((matcher.outstanding * DEFAULT_MIN_INTERVAL_MS) / 60_000);

  const stats: { label: string; value: string | number; tone?: string; hint?: string }[] = [
    { label: 'Tracks', value: summary.total },
    { label: 'Likely matches', value: summary.likely, tone: 'text-verified-400', hint: 'High confidence or picked by you' },
    { label: 'Need review', value: summary.review, tone: summary.review ? 'text-review-300' : undefined, hint: 'Review suggested, no reliable match, or lookup failed' },
    { label: 'Purchased', value: summary.purchased, tone: 'text-verified-400' },
    { label: 'Skipped', value: summary.skipped },
    { label: 'Remaining', value: summary.remaining, tone: 'text-cue-400' },
  ];

  return (
    <section aria-label="Workspace summary" className="panel p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="w-full min-w-0 sm:w-auto sm:flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink-100">Collection progress</h2>
            <span className="font-mono text-sm whitespace-nowrap text-ink-300 tabular-nums">
              {handled}/{summary.total} done · {percent}%
            </span>
          </div>
          <div
            className="mt-2 flex h-2 overflow-hidden rounded-full bg-ink-700"
            role="progressbar"
            aria-label="Tracks purchased or skipped"
            aria-valuemin={0}
            aria-valuemax={summary.total}
            aria-valuenow={handled}
          >
            <div className="bg-verified-500 transition-[width]" style={{ width: `${summary.total ? (summary.purchased / summary.total) * 100 : 0}%` }} />
            <div className="bg-ink-500 transition-[width]" style={{ width: `${summary.total ? (summary.skipped / summary.total) * 100 : 0}%` }} />
            <div className="bg-info-400/60 transition-[width]" style={{ width: `${summary.total ? (summary.found / summary.total) * 100 : 0}%` }} />
          </div>
        </div>
        <div className="sm:text-right">
          <p className="text-xs text-ink-400">Known cost of remaining tracks</p>
          <p className="font-mono text-xl font-semibold text-ink-100 tabular-nums">{formatCosts(summary.remainingCost)}</p>
          {summary.unpricedRemaining > 0 && (
            <p className="text-xs text-review-300">
              + {summary.unpricedRemaining} {summary.unpricedRemaining === 1 ? 'track' : 'tracks'} with no known price
              {summary.pending > 0 ? ' yet' : ''}
            </p>
          )}
          {summary.spentCost.length > 0 && (
            <p className="text-xs text-ink-400">Marked purchased: {formatCosts(summary.spentCost)}</p>
          )}
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg border border-ink-700/70 bg-ink-900/60 px-3 py-2" title={s.hint}>
            <dt className="text-[11px] text-ink-400">{s.label}</dt>
            <dd className={`font-mono text-lg font-semibold tabular-nums ${s.tone ?? 'text-ink-100'}`}>{s.value}</dd>
          </div>
        ))}
      </dl>

      {(matcher.outstanding > 0 || !autoMatch) && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ink-700/70 bg-ink-900/60 px-3 py-2 text-xs text-ink-300" aria-live="polite">
          <span>
            {backoffSeconds > 0 ? (
              <span className="text-review-300">
                {matcher.pauseReason === 'rate_limited'
                  ? 'Apple asked us to slow down'
                  : matcher.pauseReason === 'possibly_rate_limited'
                    ? 'Apple didn’t answer the last lookup (it may be limiting requests)'
                    : 'A lookup failed'}
                {' '}— resuming lookups in {backoffSeconds}s.
              </span>
            ) : matcher.outstanding > 0 && autoMatch ? (
              <>
                Matching {matcher.outstanding} {matcher.outstanding === 1 ? 'track' : 'tracks'} against the iTunes catalog · about{' '}
                {etaMinutes} min left. Lookups are paced to respect Apple’s rate limit; search links work meanwhile.
              </>
            ) : (
              <>Automatic matching is paused{matcher.outstanding > 0 ? ` · ${matcher.outstanding} waiting` : ''}.</>
            )}
          </span>
          <button type="button" className="btn btn-ghost px-2 py-1 text-xs" onClick={onToggleAutoMatch}>
            {autoMatch ? <Pause aria-hidden className="size-3.5" /> : <Play aria-hidden className="size-3.5" />}
            {autoMatch ? 'Pause matching' : 'Resume matching'}
          </button>
        </div>
      )}
    </section>
  );
}
