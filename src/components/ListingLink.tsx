import { BadgeCheck, ExternalLink, HelpCircle } from 'lucide-react';
import type { RankedCandidate } from '../types';
import { formatPrice, listingKind } from '../state/selectors';
import { cx } from './cx';

interface Props {
  candidate: RankedCandidate | undefined;
  trackLabel: string;
  onOpen?: () => void;
  size?: 'sm' | 'md';
}

/**
 * The link to a specific recording's store page. Never labelled "Buy": the
 * purchase itself happens in Apple's store, and the link may open Apple Music
 * on the web where purchase options are not shown.
 */
export function ListingLink({ candidate, trackLabel, onOpen, size = 'md' }: Props) {
  const kind = listingKind(candidate);
  const recording = candidate?.recording;
  if (kind === 'none' || !recording?.listingUrl) return null;

  const price = recording.price !== undefined && recording.currency ? formatPrice(recording.price, recording.currency) : undefined;
  const verified = kind === 'verified';

  return (
    <a
      href={recording.listingUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        e.stopPropagation();
        onOpen?.();
      }}
      aria-label={
        verified
          ? `Open iTunes Store listing for ${trackLabel}, ${price} (opens in new tab)`
          : `Open catalog listing for ${trackLabel}; no individual track price (opens in new tab)`
      }
      title={
        verified
          ? 'Verified iTunes Store listing for this exact recording. Complete the purchase in Apple’s store.'
          : 'Apple lists this recording but not as an individually priced track (it may be album-only or unavailable).'
      }
      className={cx(
        'btn',
        size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-1.5 text-xs',
        verified
          ? 'border border-verified-500/50 bg-verified-500/15 text-verified-400 hover:bg-verified-500/25'
          : 'border border-review-400/40 bg-review-400/5 text-review-300 hover:bg-review-400/15',
      )}
    >
      {verified ? <BadgeCheck aria-hidden className="size-3.5" /> : <HelpCircle aria-hidden className="size-3.5" />}
      {verified ? 'iTunes listing' : 'Listing (no price)'}
      {price && <span className="font-mono tabular-nums">{price}</span>}
      <ExternalLink aria-hidden className="size-3 opacity-70" />
    </a>
  );
}
