import { useState } from 'react';
import { Disc3 } from 'lucide-react';
import { cx } from './cx';

export function Artwork({ src, size = 'md', alt = '' }: { src?: string; size?: 'sm' | 'md' | 'lg'; alt?: string }) {
  const [failed, setFailed] = useState(false);
  const dims = size === 'sm' ? 'size-9' : size === 'lg' ? 'size-14' : 'size-11';
  if (!src || failed) {
    return (
      <div className={cx(dims, 'grid shrink-0 place-items-center rounded-md border border-ink-700 bg-ink-800 text-ink-500')}>
        <Disc3 aria-hidden className="size-1/2" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={cx(dims, 'shrink-0 rounded-md border border-ink-700 bg-ink-800 object-cover')}
    />
  );
}
