import { BadgeCheck, CircleHelp, CircleSlash, ExternalLink, KeyRound, Loader2, RefreshCw, Search, Star, WifiOff } from 'lucide-react';
import type { Track, WorkspaceSettings } from '../types';
import {
  ACQUISITION_PROVIDERS,
  orderedPools,
  type AcquisitionProvider,
  type AcquisitionProviderId,
  type PoolId,
} from '../lib/acquisition/providers';
import { evidenceFor, openedText, type Evidence, type EvidenceState } from '../lib/acquisition/evidence';
import { SEARCH_LINK_PROVIDERS, searchTermFor } from '../lib/providers/searchLinks';
import { cx } from './cx';

const EVIDENCE_STYLE: Record<EvidenceState, { className: string; Icon: typeof BadgeCheck }> = {
  verified: { className: 'border-verified-500/40 bg-verified-500/10 text-verified-400', Icon: BadgeCheck },
  possible: { className: 'border-review-400/40 bg-review-400/10 text-review-300', Icon: CircleHelp },
  'not-found': { className: 'border-ink-600 text-ink-300', Icon: CircleSlash },
  unable: { className: 'border-nomatch-400/40 text-nomatch-400', Icon: WifiOff },
  stale: { className: 'border-review-400/40 text-review-300', Icon: RefreshCw },
  checking: { className: 'border-ink-600 text-ink-300', Icon: Loader2 },
  'search-only': { className: 'border-ink-600 text-ink-300', Icon: Search },
  membership: { className: 'border-ink-600 text-ink-300', Icon: KeyRound },
};

export function EvidenceBadge({ evidence }: { evidence: Evidence }) {
  const { className, Icon } = EVIDENCE_STYLE[evidence.state];
  return (
    <span className={cx('chip', className)}>
      <Icon aria-hidden className={cx('size-3', evidence.state === 'checking' && 'animate-spin')} />
      {evidence.label}
    </span>
  );
}

export function SourceToggle({
  provider,
  chosen,
  onChange,
}: {
  provider: AcquisitionProvider;
  chosen: boolean;
  onChange: (source: AcquisitionProviderId | undefined) => void;
}) {
  const text = chosen ? 'My source' : 'Use as my source';
  return (
    <button
      type="button"
      aria-pressed={chosen}
      aria-label={`${text} (${provider.name})`}
      onClick={() => onChange(chosen ? undefined : provider.id)}
      className={cx('btn px-2 py-1 text-xs', chosen ? 'btn-secondary text-cue-300' : 'btn-ghost')}
    >
      <Star aria-hidden className={cx('size-3.5', chosen && 'fill-current')} />
      {text}
    </button>
  );
}

interface PanelProps {
  track: Track;
  settings: WorkspaceSettings;
  now: number;
  onOpen: (provider: AcquisitionProviderId) => void;
  onSetSource: (source: AcquisitionProviderId | undefined) => void;
}

/** Store search links and DJ pool entry points: everything except the iTunes catalog lookup. */
export function OtherProviders({ track, settings, now, onOpen, onSetSource }: PanelProps) {
  const stores = ACQUISITION_PROVIDERS.filter((p) => p.kind === 'store' && p.access !== 'catalog-api');
  const pools = orderedPools(settings.poolsIUse);
  const row = (provider: AcquisitionProvider) => (
    <ProviderRow key={provider.id} provider={provider} track={track} settings={settings} now={now} onOpen={onOpen} onSetSource={onSetSource} />
  );
  return (
    <>
      <section aria-label="Other stores" className="mt-5">
        <h3 className="text-sm font-semibold text-ink-100">Other stores</h3>
        <p className="mb-2 text-xs text-ink-400">
          These stores don’t offer catalog access CrateBridge can check, so their links open the store’s own search.
          {settings.searchModifiers.length > 0 && <> Adding: {settings.searchModifiers.join(', ')}.</>}
        </p>
        <ul className="grid gap-2">{stores.map(row)}</ul>
      </section>
      <section aria-label="DJ pools" className="mt-5">
        <h3 className="text-sm font-semibold text-ink-100">DJ pools</h3>
        <p className="mb-2 text-xs text-ink-400">
          Pools need a membership and offer no public catalog access, so CrateBridge can’t check them; the links open each pool’s
          site. Choose the pools you use in Settings to list them first.
        </p>
        <ul className="grid gap-2">{pools.map(row)}</ul>
      </section>
    </>
  );
}

function ProviderRow({ provider, track, settings, now, onOpen, onSetSource }: PanelProps & { provider: AcquisitionProvider }) {
  const evidence = evidenceFor(track, provider, now);
  const opened = openedText(track.acquisition?.opened?.[provider.id], now);
  const isSearch = provider.access === 'search-link';
  const href = isSearch ? provider.searchUrl!(track, settings.country, settings.searchModifiers) : provider.entryUrl!;
  const youUse = provider.kind === 'pool' && settings.poolsIUse.includes(provider.id as PoolId);
  const label = isSearch ? `Search ${provider.name}` : `Open ${provider.name}`;

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-ink-700 bg-ink-850 px-3 py-2">
      <div className="min-w-0 flex-1 basis-56">
        <p className="flex flex-wrap items-center gap-1.5 text-sm text-ink-100">
          {provider.name}
          {youUse && <span className="chip border-info-400/30 text-info-400">You use this</span>}
          <EvidenceBadge evidence={evidence} />
        </p>
        <p className="text-xs text-ink-400">
          {provider.note}
          {opened && <> · {opened}</>}
        </p>
      </div>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => onOpen(provider.id)}
        className="btn btn-secondary px-2.5 py-1.5 text-xs"
        aria-label={`${label} (${isSearch ? 'search results' : 'site'}, opens in new tab)`}
      >
        {isSearch ? <Search aria-hidden className="size-3.5" /> : <ExternalLink aria-hidden className="size-3.5" />}
        {label}
      </a>
      <SourceToggle provider={provider} chosen={track.acquisition?.source === provider.id} onChange={onSetSource} />
    </li>
  );
}

/** Streaming catalogs aren't purchase pages, so they sit apart from stores and pools. */
export function SearchElsewhere({ track, settings }: { track: Track; settings: WorkspaceSettings }) {
  const streaming = SEARCH_LINK_PROVIDERS.filter((p) => p.kind === 'streaming-catalog');
  const term = searchTermFor(track, settings.searchModifiers);
  return (
    <section>
      <h3 className="mb-1 text-sm font-semibold text-ink-100">Search elsewhere</h3>
      <ul className="grid gap-1">
        {streaming.map((provider) => (
          <li key={provider.id}>
            <a
              href={provider.buildUrl(term, settings.country)}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-start gap-2 rounded-lg px-2.5 py-2 text-sm hover:bg-ink-750 focus-visible:bg-ink-750"
            >
              <ExternalLink aria-hidden className="mt-0.5 size-3.5 shrink-0 text-ink-400 group-hover:text-ink-200" />
              <span className="min-w-0">
                <span className="block text-ink-100">
                  {provider.name}
                  <span className="sr-only"> search (opens in new tab)</span>
                </span>
                <span className="block text-xs text-review-300">{provider.note}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
