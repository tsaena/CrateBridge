import { useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { AlertTriangle, ClipboardPaste, FileSpreadsheet, Plus, Sparkles, Upload } from 'lucide-react';
import type { TrackDraft, TrackSource } from '../types';
import { parseTracklist, type LineOrder } from '../lib/import/parseTracklist';
import { importCsv, type ColumnMapping, type CsvField } from '../lib/import/parseCsv';
import { SAMPLE_PLAYLIST } from '../data/samplePlaylist';
import { cx } from './cx';

type Tab = 'paste' | 'csv' | 'manual';

interface Props {
  onImport: (drafts: TrackDraft[], source: TrackSource) => void;
  hasTracks: boolean;
}

export function ImportPanel({ onImport, hasTracks }: Props) {
  const [tab, setTab] = useState<Tab>('paste');
  const tabs: { id: Tab; label: string; Icon: typeof Upload }[] = [
    { id: 'paste', label: 'Paste tracklist', Icon: ClipboardPaste },
    { id: 'csv', label: 'Upload CSV', Icon: FileSpreadsheet },
    { id: 'manual', label: 'Add a track', Icon: Plus },
  ];
  const baseId = useId();

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="Import method" className="flex flex-wrap gap-1 rounded-xl border border-ink-700 bg-ink-900 p-1">
          {tabs.map(({ id, label, Icon }) => (
            <button
              key={id}
              id={`${baseId}-${id}-tab`}
              role="tab"
              type="button"
              aria-selected={tab === id}
              aria-controls={`${baseId}-${id}-panel`}
              onClick={() => setTab(id)}
              className={cx(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                tab === id ? 'bg-ink-700 text-ink-100' : 'text-ink-400 hover:text-ink-100',
              )}
            >
              <Icon aria-hidden className="size-4" />
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => onImport(parseTracklist(SAMPLE_PLAYLIST).lines, 'sample')}
        >
          <Sparkles aria-hidden className="size-4 text-cue-400" />
          {hasTracks ? 'Add sample playlist' : 'Try the sample playlist'}
        </button>
      </div>

      <div id={`${baseId}-${tab}-panel`} role="tabpanel" aria-labelledby={`${baseId}-${tab}-tab`} className="mt-4">
        {tab === 'paste' && <PasteImport onImport={(drafts) => onImport(drafts, 'paste')} />}
        {tab === 'csv' && <CsvImportForm onImport={(drafts) => onImport(drafts, 'csv')} />}
        {tab === 'manual' && <ManualAdd onImport={(drafts) => onImport(drafts, 'manual')} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface RowEdit {
  artist: string;
  title: string;
  include: boolean;
}

function PasteImport({ onImport }: { onImport: (drafts: TrackDraft[]) => void }) {
  const [text, setText] = useState('');
  const [order, setOrder] = useState<LineOrder>('artist-title');
  const [edits, setEdits] = useState<Record<number, RowEdit>>({});
  const textareaId = useId();

  const parsed = useMemo(() => parseTracklist(text, order), [text, order]);
  const flagged = parsed.lines.filter((l) => !l.ok || l.warning);
  const clean = parsed.lines.filter((l) => l.ok && !l.warning);

  const resolved = (lineNumber: number, fallback: { artist: string; title: string; ok: boolean }): RowEdit =>
    edits[lineNumber] ?? { artist: fallback.artist, title: fallback.title, include: fallback.ok };

  const drafts: TrackDraft[] = parsed.lines.flatMap((line) => {
    if (line.ok && !line.warning) return [line];
    const edit = resolved(line.lineNumber, line);
    if (!edit.include || !edit.title.trim()) return [];
    const changed = edit.artist !== line.artist || edit.title !== line.title;
    const complete = Boolean(edit.artist.trim() && edit.title.trim());
    return [
      {
        ...line,
        artist: edit.artist,
        title: edit.title,
        // Keep the warning unless the user fixed the row themselves.
        warning: changed && complete ? undefined : (line.warning ?? undefined),
      },
    ];
  });

  const setEdit = (lineNumber: number, base: RowEdit, changes: Partial<RowEdit>) =>
    setEdits((prev) => ({ ...prev, [lineNumber]: { ...base, ...changes } }));

  const submit = () => {
    if (drafts.length === 0) return;
    onImport(drafts);
    setText('');
    setEdits({});
  };

  return (
    <div className="grid gap-4">
      <div>
        <div className="mb-1.5 flex flex-wrap items-end justify-between gap-2">
          <label htmlFor={textareaId} className="text-sm font-medium text-ink-200">
            Paste one track per line
          </label>
          <label className="flex items-center gap-2 text-xs text-ink-400">
            Line format
            <select
              value={order}
              onChange={(e) => {
                setOrder(e.target.value as LineOrder);
                setEdits({});
              }}
              className="field w-auto py-1 text-xs"
            >
              <option value="artist-title">Artist – Title</option>
              <option value="title-artist">Title – Artist</option>
            </select>
          </label>
        </div>
        <textarea
          id={textareaId}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setEdits({});
          }}
          rows={8}
          spellCheck={false}
          placeholder={'The Weeknd - Blinding Lights\nUsher - Yeah!\nThe Killers - Mr. Brightside\nLady Gaga – Poker Face\nDaft Punk — One More Time'}
          className="field min-h-40 resize-y font-mono text-[13px] leading-6"
        />
        <p className="mt-1.5 text-xs text-ink-400">
          Hyphens, en/em dashes, tabs, numbered lists, and DJ timestamps are all fine. Blank lines are ignored.
        </p>
      </div>

      {parsed.lines.length > 0 && (
        <div className="rounded-xl border border-ink-700 bg-ink-900/60">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-700 px-4 py-3">
            <p className="text-sm text-ink-200" aria-live="polite">
              <span className="font-semibold text-ink-100">{drafts.length}</span> ready to import
              {flagged.length > 0 && (
                <>
                  {' · '}
                  <span className="text-review-300">{flagged.length} need a look</span>
                </>
              )}
            </p>
            <button type="button" className="btn btn-primary" onClick={submit} disabled={drafts.length === 0}>
              Import {drafts.length} {drafts.length === 1 ? 'track' : 'tracks'}
            </button>
          </div>

          {flagged.length > 0 && (
            <ul className="divide-y divide-ink-700/70" aria-label="Lines that need a look">
              {flagged.map((line) => {
                const edit = resolved(line.lineNumber, line);
                return (
                  <li key={line.lineNumber} className="grid gap-2 px-4 py-3">
                    <div className="flex items-start gap-2 text-xs">
                      <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0 text-review-400" />
                      <span className="text-ink-300">
                        <span className="font-mono text-ink-400">Line {line.lineNumber}:</span>{' '}
                        <span className="font-mono text-ink-200">{line.raw}</span>
                        <span className="block text-review-300">{line.warning}</span>
                      </span>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-center">
                      <input
                        aria-label={`Artist for line ${line.lineNumber}`}
                        className="field py-1.5"
                        placeholder="Artist"
                        value={edit.artist}
                        onChange={(e) => setEdit(line.lineNumber, edit, { artist: e.target.value, include: true })}
                      />
                      <input
                        aria-label={`Title for line ${line.lineNumber}`}
                        className="field py-1.5"
                        placeholder="Title"
                        value={edit.title}
                        onChange={(e) => setEdit(line.lineNumber, edit, { title: e.target.value, include: true })}
                      />
                      <label className="flex items-center gap-2 text-xs text-ink-300">
                        <input
                          type="checkbox"
                          className="size-4 accent-cue-500"
                          checked={edit.include}
                          onChange={(e) => setEdit(line.lineNumber, edit, { include: e.target.checked })}
                        />
                        Include
                      </label>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {clean.length > 0 && (
            <details className="group border-t border-ink-700 first:border-t-0">
              <summary className="px-4 py-2.5 text-xs font-medium text-ink-400 hover:text-ink-200">
                Preview {clean.length} parsed {clean.length === 1 ? 'line' : 'lines'}
              </summary>
              <ol className="max-h-64 overflow-auto px-4 pb-3 text-sm">
                {clean.map((line) => (
                  <li key={line.lineNumber} className="grid grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,1fr)] gap-2 py-1">
                    <span className="font-mono text-xs leading-5 text-ink-500">{line.lineNumber}</span>
                    <span className="truncate text-ink-300">{line.artist}</span>
                    <span className="truncate text-ink-100">{line.title}</span>
                  </li>
                ))}
              </ol>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

const FIELD_LABELS: Record<CsvField, string> = {
  title: 'Title',
  artist: 'Artist',
  album: 'Album',
  duration: 'Duration',
  isrc: 'ISRC',
};

function CsvImportForm({ onImport }: { onImport: (drafts: TrackDraft[]) => void }) {
  const [file, setFile] = useState<{ name: string; text: string }>();
  const [mapping, setMapping] = useState<ColumnMapping>();
  const [readError, setReadError] = useState<string>();
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  const result = useMemo(() => (file ? importCsv(file.text, mapping) : undefined), [file, mapping]);
  const flaggedCount = result?.drafts.filter((d) => d.warning).length ?? 0;

  const load = async (picked: File | undefined) => {
    if (!picked) return;
    setReadError(undefined);
    setMapping(undefined);
    if (picked.size > 5 * 1024 * 1024) {
      setReadError('That file is larger than 5 MB. Export just the playlist you need.');
      return;
    }
    try {
      setFile({ name: picked.name, text: await picked.text() });
    } catch {
      setReadError('Couldn’t read that file.');
    }
  };

  const submit = () => {
    if (!result?.drafts.length) return;
    onImport(result.drafts);
    setFile(undefined);
    setMapping(undefined);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="grid gap-4">
      <label
        htmlFor={inputId}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void load(e.dataTransfer.files[0]);
        }}
        className={cx(
          'flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center transition-colors',
          dragging ? 'border-cue-400 bg-cue-500/5' : 'border-ink-600 bg-ink-900/60 hover:border-ink-500',
        )}
      >
        <Upload aria-hidden className="size-6 text-ink-400" />
        <span className="text-sm text-ink-200">
          {file ? (
            <>
              Loaded <span className="font-medium text-ink-100">{file.name}</span> — choose another file
            </>
          ) : (
            <>Drop a CSV here or click to choose a file</>
          )}
        </span>
        <span className="text-xs text-ink-400">
          Needs Title and Artist columns (e.g. “Track Name”, “Artist Name(s)”). Exports from tools like Exportify work.
        </span>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values"
          className="sr-only"
          onChange={(e) => void load(e.target.files?.[0])}
        />
      </label>

      {readError && <p className="text-sm text-nomatch-400">{readError}</p>}

      {result && (
        <div className="grid gap-3 rounded-xl border border-ink-700 bg-ink-900/60 p-4">
          <fieldset className="grid gap-2 sm:grid-cols-3">
            <legend className="mb-1 text-xs font-medium tracking-wide text-ink-400 uppercase">Columns</legend>
            {(['title', 'artist', 'album'] as CsvField[]).map((field) => (
              <label key={field} className="grid gap-1 text-xs text-ink-300">
                {FIELD_LABELS[field]}
                <select
                  className="field py-1.5"
                  value={result.mapping[field] ?? ''}
                  onChange={(e) => setMapping({ ...result.mapping, [field]: e.target.value || undefined })}
                >
                  <option value="">— none —</option>
                  {result.table.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </fieldset>

          {result.table.errors.length > 0 && (
            <ul className="text-xs text-review-300">
              {result.table.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}

          {!result.mapping.title && !result.mapping.artist ? (
            <p className="text-sm text-review-300">
              Couldn’t find title or artist columns. Pick them above. Found: {result.table.headers.join(', ') || 'no headers'}.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[28rem] text-left text-sm">
                  <thead className="text-xs text-ink-400">
                    <tr>
                      <th className="py-1 pr-3 font-medium">Artist</th>
                      <th className="py-1 pr-3 font-medium">Title</th>
                      <th className="py-1 font-medium">Album</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.drafts.slice(0, 5).map((d, i) => (
                      <tr key={i} className="border-t border-ink-700/60">
                        <td className="max-w-40 truncate py-1.5 pr-3 text-ink-300">{d.artist || <em className="text-review-300">missing</em>}</td>
                        <td className="max-w-48 truncate py-1.5 pr-3 text-ink-100">{d.title || <em className="text-review-300">missing</em>}</td>
                        <td className="max-w-40 truncate py-1.5 text-ink-400">{d.album}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-ink-400">
                  {result.drafts.length} rows
                  {result.drafts.length > 5 && ' (first 5 shown)'}
                  {flaggedCount > 0 && <span className="text-review-300"> · {flaggedCount} missing a title or artist (imported and flagged)</span>}
                  {result.emptyRows > 0 && ` · ${result.emptyRows} empty rows skipped`}
                </p>
                <button type="button" className="btn btn-primary" onClick={submit} disabled={result.drafts.length === 0}>
                  Import {result.drafts.length} {result.drafts.length === 1 ? 'track' : 'tracks'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ManualAdd({ onImport }: { onImport: (drafts: TrackDraft[]) => void }) {
  const [artist, setArtist] = useState('');
  const [title, setTitle] = useState('');
  const [album, setAlbum] = useState('');
  const artistRef = useRef<HTMLInputElement>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!artist.trim() || !title.trim()) return;
    onImport([{ artist, title, album: album || undefined }]);
    setArtist('');
    setTitle('');
    setAlbum('');
    artistRef.current?.focus();
  };

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
      <label className="grid gap-1 text-xs font-medium text-ink-300">
        Artist
        <input ref={artistRef} className="field" value={artist} onChange={(e) => setArtist(e.target.value)} required placeholder="e.g. Robyn" />
      </label>
      <label className="grid gap-1 text-xs font-medium text-ink-300">
        Title
        <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="e.g. Dancing On My Own" />
      </label>
      <label className="grid gap-1 text-xs font-medium text-ink-300">
        Album <span className="font-normal text-ink-500">(optional)</span>
        <input className="field" value={album} onChange={(e) => setAlbum(e.target.value)} placeholder="Helps pick the right version" />
      </label>
      <button type="submit" className="btn btn-primary" disabled={!artist.trim() || !title.trim()}>
        <Plus aria-hidden className="size-4" />
        Add track
      </button>
    </form>
  );
}
