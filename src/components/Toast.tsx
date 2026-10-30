import { X } from 'lucide-react';

export interface ToastMessage {
  id: number;
  text: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: 'info' | 'error';
}

export function Toast({ toast, onDismiss }: { toast: ToastMessage; onDismiss: () => void }) {
  return (
    <div
      role={toast.tone === 'error' ? 'alert' : 'status'}
      className="pointer-events-auto flex items-center gap-3 rounded-xl border border-ink-600 bg-ink-800 px-4 py-3 text-sm text-ink-100 shadow-2xl shadow-black/60"
    >
      <span className={toast.tone === 'error' ? 'text-nomatch-400' : undefined}>{toast.text}</span>
      {toast.actionLabel && toast.onAction && (
        <button
          type="button"
          className="font-semibold text-cue-400 hover:text-cue-300"
          onClick={() => {
            toast.onAction?.();
            onDismiss();
          }}
        >
          {toast.actionLabel}
        </button>
      )}
      <button type="button" aria-label="Dismiss" className="text-ink-400 hover:text-ink-100" onClick={onDismiss}>
        <X aria-hidden className="size-4" />
      </button>
    </div>
  );
}
