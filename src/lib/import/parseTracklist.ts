import type { TrackDraft } from '../../types';
import { parseDuration, splitTitle } from '../normalize';

export type LineOrder = 'artist-title' | 'title-artist';

export interface ParsedLine extends TrackDraft {
  raw: string;
  lineNumber: number;
  /** False when artist and title could not be separated. */
  ok: boolean;
}

export interface TracklistParseResult {
  lines: ParsedLine[];
  /** Lines that were ignored entirely (blank lines, headings). */
  skipped: number;
}

// Leading list markers: "1.", "01)", "#3", "[2]", "4:", bullets, and "1 -" (only
// when another separator follows, so "50 Cent - In Da Club" is left alone).
const LIST_MARKER = /^(?:#\s*\d{1,4}\s*[.):-]?|\[\d{1,4}\]|\(\d{1,4}\)|\d{1,4}\s*[.):]|[•·*▪►▶–—-])\s+/u;
const DASH_NUMBER_MARKER = /^\d{1,4}\s*[-–—]\s+/u;
// DJ tracklist timestamps such as "00:00", "[1:02:33]", "(12:45)".
const TIMESTAMP = /^[[(]?\d{1,2}:\d{2}(?::\d{2})?[\])]?\s+/;
// A trailing duration like "3:21", "(3:21)", or "[3:21]".
const TRAILING_DURATION = /\s+[[(]?(\d{1,2}:\d{2}(?::\d{2})?)[\])]?\s*$/;

/** Separators in priority order. Spaced dashes are unambiguous; unspaced en/em dashes are a fallback. */
const SEPARATORS: { pattern: RegExp; label: string }[] = [
  { pattern: /\s+[-–—―]\s+/u, label: 'dash' },
  { pattern: /\t+/, label: 'tab' },
  { pattern: /\s*[–—―]\s*/u, label: 'unspaced dash' },
  { pattern: /\s+\|\s+/, label: 'pipe' },
];

const URL_LINE = /^https?:\/\//i;
const SPOTIFY_URI = /^spotify:/i;

export function parseTracklist(text: string, order: LineOrder = 'artist-title'): TracklistParseResult {
  const lines: ParsedLine[] = [];
  let skipped = 0;

  text.split(/\r\n|\r|\n/).forEach((rawLine, index) => {
    const raw = rawLine.replace(/\u00a0/g, ' ').trim();
    if (!raw) {
      skipped += 1;
      return;
    }
    lines.push(parseLine(raw, index + 1, order));
  });

  return { lines, skipped };
}

export function parseLine(raw: string, lineNumber: number, order: LineOrder = 'artist-title'): ParsedLine {
  const base = { raw, lineNumber };

  if (URL_LINE.test(raw) || SPOTIFY_URI.test(raw)) {
    return {
      ...base,
      ok: false,
      artist: '',
      title: '',
      warning:
        'Links can’t be resolved without signing in to the streaming service. Paste “Artist – Title” text or a CSV export instead.',
    };
  }

  // Collapse runs of spaces but keep tabs, which can separate spreadsheet columns.
  let text = raw.normalize('NFC').replace(/[^\S\t]+/g, ' ');
  text = text.replace(TIMESTAMP, '');
  let durationMs: number | undefined;
  const duration = TRAILING_DURATION.exec(text);
  if (duration) {
    durationMs = parseDuration(duration[1]);
    text = text.slice(0, duration.index);
  }
  text = stripListMarker(text);
  text = stripWrappingQuotes(text);

  for (const separator of SEPARATORS) {
    const match = separator.pattern.exec(text);
    if (!match) continue;
    const left = text.slice(0, match.index).trim();
    const right = text.slice(match.index + match[0].length).trim();
    if (!left || !right) continue;

    const [artist, title] = order === 'artist-title' ? [left, right] : [right, left];
    return {
      ...base,
      ok: true,
      artist,
      title,
      durationMs,
      warning: isAmbiguousSplit(text, title)
        ? 'Line has more than one separator. Check that artist and title are split correctly.'
        : undefined,
    };
  }

  const byMatch = /^(.+?)\s+by\s+(.+)$/i.exec(text);
  if (byMatch?.[1] && byMatch[2]) {
    return {
      ...base,
      ok: true,
      title: byMatch[1].trim(),
      artist: byMatch[2].trim(),
      durationMs,
      warning: 'Read as “Title by Artist”. Check the split.',
    };
  }

  return {
    ...base,
    ok: false,
    artist: '',
    title: text,
    durationMs,
    warning: 'Couldn’t find an artist/title separator. Add the artist or edit the line.',
  };
}

/** Remove quotes around the whole line, leaving apostrophes like "Beggin'" alone. */
function stripWrappingQuotes(text: string): string {
  const match = /^(["“”'‘’])(.*)(["“”'‘’])$/u.exec(text);
  if (!match?.[2]) return text;
  const pairs: Record<string, string> = { '"': '"', '“': '”', '”': '”', "'": "'", '‘': '’', '’': '’' };
  return pairs[match[1]!] === match[3] ? match[2].trim() : text;
}

function stripListMarker(text: string): string {
  const marker = LIST_MARKER.exec(text);
  if (marker) return text.slice(marker[0].length);
  const dashMarker = DASH_NUMBER_MARKER.exec(text);
  if (dashMarker) {
    const rest = text.slice(dashMarker[0].length);
    // Only treat "1 - " as numbering when the remainder still has its own separator.
    if (SEPARATORS.some((s) => s.pattern.test(rest))) return rest;
  }
  return text;
}

/**
 * A second spaced dash is fine when it introduces a version qualifier
 * ("Dreams - 2004 Remaster"), but otherwise the split is a guess.
 */
function isAmbiguousSplit(text: string, title: string): boolean {
  const dashCount = (text.match(/\s+[-–—―]\s+/gu) ?? []).length;
  if (dashCount < 2) return false;
  return /\s[-–—―]\s/u.test(splitTitle(title).core);
}
