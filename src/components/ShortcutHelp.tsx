const SHORTCUTS: [string, string][] = [
  ['J / K', 'Next / previous track'],
  ['O or Enter', 'Open the selected iTunes listing'],
  ['P', 'Mark purchased and move on'],
  ['F', 'Mark found'],
  ['S', 'Skip and move on'],
  ['N', 'Reset to not started'],
  ['V', 'Show or hide versions'],
  ['/', 'Filter tracks'],
  ['?', 'Toggle this help'],
];

export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  return (
    <section aria-label="Keyboard shortcuts" className="panel p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink-100">Keyboard shortcuts</h2>
        <button type="button" className="btn btn-ghost px-2 py-1 text-xs" onClick={onClose}>
          Close
        </button>
      </div>
      <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-3">
        {SHORTCUTS.map(([keys, label]) => (
          <div key={keys} className="flex items-center gap-2">
            <dt className="min-w-24">
              {keys.split(' ').map((k, i) =>
                k === '/' && i > 0 ? (
                  <span key={i} className="text-ink-500"> / </span>
                ) : k === 'or' ? (
                  <span key={i} className="text-ink-500"> or </span>
                ) : (
                  <kbd key={i} className="kbd">
                    {k}
                  </kbd>
                ),
              )}
            </dt>
            <dd className="text-ink-300">{label}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
