import { useState, type FormEvent } from 'react';
import { Check, ListMusic, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { Playlist } from '../types';
import { MAX_PLAYLIST_NAME_LENGTH } from '../state/workspace';

interface Props {
  playlists: Playlist[];
  activeId: string;
  onSwitch: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  /** Open with the name ready to edit, e.g. right after the playlist was created. */
  startRenaming?: boolean;
}

/** Render with `key={activeId}` so switching playlists resets the rename and delete prompts. */
export function PlaylistBar({ playlists, activeId, onSwitch, onCreate, onRename, onDelete, startRenaming }: Props) {
  const active = playlists.find((p) => p.id === activeId) ?? playlists[0]!;
  const [renaming, setRenaming] = useState(Boolean(startRenaming));
  const [draft, setDraft] = useState(active.name);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const startRename = () => {
    setDraft(active.name);
    setConfirmDelete(false);
    setRenaming(true);
  };

  const submitRename = (event: FormEvent) => {
    event.preventDefault();
    if (draft.trim()) onRename(active.id, draft);
    setRenaming(false);
  };

  const trackCount = (p: Playlist) => `${p.tracks.length} ${p.tracks.length === 1 ? 'track' : 'tracks'}`;

  return (
    <section aria-label="Playlists" className="flex flex-wrap items-center gap-2">
      <ListMusic aria-hidden className="size-4 text-cue-400" />
      {renaming ? (
        <form onSubmit={submitRename} className="flex flex-wrap items-center gap-2">
          <input
            // Focus moves here only because the user just asked to rename or create.
            autoFocus
            onFocus={(e) => e.target.select()}
            aria-label="Playlist name"
            className="field w-64 py-1.5"
            value={draft}
            maxLength={MAX_PLAYLIST_NAME_LENGTH}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setRenaming(false);
            }}
          />
          <button type="submit" className="btn btn-secondary px-2.5 py-1.5 text-xs" disabled={!draft.trim()}>
            <Check aria-hidden className="size-3.5" />
            Save name
          </button>
          <button type="button" className="btn btn-ghost px-2 py-1.5 text-xs" onClick={() => setRenaming(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <label className="flex items-center gap-2">
          <span className="sr-only">Current playlist</span>
          <select className="field w-auto max-w-[min(20rem,70vw)] py-1.5 font-medium" value={active.id} onChange={(e) => onSwitch(e.target.value)}>
            {playlists.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({trackCount(p)})
              </option>
            ))}
          </select>
        </label>
      )}

      {!renaming && !confirmDelete && (
        <>
          <button type="button" className="btn btn-ghost px-2.5 py-1.5 text-xs" onClick={startRename}>
            <Pencil aria-hidden className="size-3.5" />
            Rename
          </button>
          <button type="button" className="btn btn-ghost px-2.5 py-1.5 text-xs" onClick={onCreate}>
            <Plus aria-hidden className="size-3.5" />
            New playlist
          </button>
          <button
            type="button"
            className="btn btn-ghost px-2.5 py-1.5 text-xs hover:text-nomatch-400"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 aria-hidden className="size-3.5" />
            Delete
          </button>
        </>
      )}

      {confirmDelete && (
        <span className="flex flex-wrap items-center gap-2 rounded-lg border border-nomatch-400/30 bg-nomatch-400/5 px-2 py-1 text-xs text-ink-200">
          Delete “{active.name}” and its {trackCount(active)}?
          <button
            type="button"
            className="btn btn-danger px-2 py-1 text-xs"
            onClick={() => {
              setConfirmDelete(false);
              onDelete(active.id);
            }}
          >
            Delete playlist
          </button>
          <button type="button" className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setConfirmDelete(false)}>
            <X aria-hidden className="size-3.5" />
            Cancel
          </button>
        </span>
      )}
    </section>
  );
}
