/** Spotify attribution for imported metadata. No artwork or audio is requested. */
export function SpotifyMark({ className = 'size-5' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M12 0a12 12 0 1 0 0 24 12 12 0 0 0 0-24zm5.504 17.307a.747.747 0 0 1-1.028.248c-2.816-1.72-6.36-2.108-10.535-1.154a.747.747 0 1 1-.333-1.456c4.568-1.044 8.486-.595 11.647 1.337a.747.747 0 0 1 .249 1.025zm1.469-3.27a.935.935 0 0 1-1.286.308c-3.223-1.981-8.136-2.555-11.948-1.398a.935.935 0 1 1-.543-1.79c4.354-1.321 9.767-.681 13.468 1.593a.935.935 0 0 1 .309 1.287zm.126-3.406c-3.866-2.296-10.245-2.507-13.937-1.386a1.122 1.122 0 1 1-.652-2.147c4.238-1.287 11.283-1.039 15.734 1.603a1.122 1.122 0 0 1-1.145 1.93z" />
    </svg>
  );
}

export function SpotifyLink({ href, children = 'Open in Spotify' }: { href: string; children?: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs text-ink-300 hover:text-ink-100 hover:underline">
      <SpotifyMark />{children}
    </a>
  );
}
