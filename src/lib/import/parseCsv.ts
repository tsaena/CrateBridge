import Papa from 'papaparse';
import type { TrackDraft } from '../../types';
import { parseDuration } from '../normalize';

export type CsvField = 'title' | 'artist' | 'album' | 'duration' | 'isrc';

export type ColumnMapping = Partial<Record<CsvField, string>>;

export interface CsvTable {
  headers: string[];
  rows: Record<string, string>[];
  /** Problems reported by the CSV parser, already summarized for display. */
  errors: string[];
}

export interface CsvImport {
  table: CsvTable;
  mapping: ColumnMapping;
  drafts: TrackDraft[];
  /** Rows dropped because they had neither artist nor title. */
  emptyRows: number;
}

/** Header aliases, compared after `canonicalHeader`. Earlier entries win. */
const ALIASES: Record<CsvField, string[]> = {
  title: ['title', 'track name', 'track', 'song', 'song name', 'song title', 'track title', 'name'],
  artist: [
    'artist',
    'artist name',
    'artist names',
    'artist name s',
    'artists',
    'artist s',
    'performer',
    'performers',
    'album artist',
  ],
  album: ['album', 'album name', 'album title', 'release', 'release name'],
  duration: ['duration', 'duration ms', 'track duration ms', 'time', 'length', 'duration s'],
  isrc: ['isrc', 'track isrc'],
};

export function canonicalHeader(header: string): string {
  return header
    .replace(/^﻿/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function detectColumns(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<string>();
  (Object.keys(ALIASES) as CsvField[]).forEach((field) => {
    for (const alias of ALIASES[field]) {
      const header = headers.find((h) => !used.has(h) && canonicalHeader(h) === alias);
      if (header) {
        mapping[field] = header;
        used.add(header);
        return;
      }
    }
  });
  return mapping;
}

export function readCsv(text: string): CsvTable {
  const result = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ''), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  });
  const headers = (result.meta.fields ?? []).filter((h) => h !== '');
  const errors = summarizeErrors(result.errors);
  return { headers, rows: result.data, errors };
}

function summarizeErrors(errors: Papa.ParseError[]): string[] {
  // Delimiter guessing on single-column files is not a real problem.
  const relevant = errors.filter((e) => e.code !== 'UndetectableDelimiter');
  const messages = relevant.slice(0, 3).map((e) => (e.row !== undefined ? `Row ${e.row + 2}: ${e.message}` : e.message));
  if (relevant.length > 3) messages.push(`…and ${relevant.length - 3} more problems.`);
  return messages;
}

export function tableToDrafts(table: CsvTable, mapping: ColumnMapping): { drafts: TrackDraft[]; emptyRows: number } {
  const drafts: TrackDraft[] = [];
  let emptyRows = 0;
  const durationIsMs = mapping.duration ? /ms/.test(canonicalHeader(mapping.duration)) : false;

  for (const row of table.rows) {
    const cell = (field: CsvField) => (mapping[field] ? (row[mapping[field]] ?? '').trim() : '');
    const title = cell('title');
    const artist = cell('artist');
    if (!title && !artist) {
      emptyRows += 1;
      continue;
    }
    const rawDuration = cell('duration');
    const durationMs = durationIsMs && /^\d+$/.test(rawDuration) ? Number(rawDuration) || undefined : parseDuration(rawDuration);
    const missing = !title ? 'title' : !artist ? 'artist' : undefined;
    drafts.push({
      title,
      artist,
      album: cell('album') || undefined,
      durationMs,
      isrc: cell('isrc') || undefined,
      warning: missing ? `Missing ${missing}.` : undefined,
      raw: Object.values(row).join(', '),
    });
  }
  return { drafts, emptyRows };
}

export function importCsv(text: string, mappingOverride?: ColumnMapping): CsvImport {
  const table = readCsv(text);
  const mapping = mappingOverride ?? detectColumns(table.headers);
  const { drafts, emptyRows } = mapping.title || mapping.artist ? tableToDrafts(table, mapping) : { drafts: [], emptyRows: 0 };
  return { table, mapping, drafts, emptyRows };
}
