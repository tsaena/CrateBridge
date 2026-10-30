import { describe, expect, it } from 'vitest';
import { detectColumns, importCsv } from './parseCsv';

describe('CSV import', () => {
  it('detects common column names', () => {
    expect(detectColumns(['Song', 'Artist', 'Album'])).toEqual({ title: 'Song', artist: 'Artist', album: 'Album' });
    expect(detectColumns(['Track Name', 'Artist Name', 'Album Name'])).toMatchObject({
      title: 'Track Name',
      artist: 'Artist Name',
      album: 'Album Name',
    });
    expect(detectColumns(['TITLE', 'ARTIST'])).toEqual({ title: 'TITLE', artist: 'ARTIST' });
  });

  it('reads an Exportify-style playlist export', () => {
    const csv = [
      '"Track URI","Track Name","Artist Name(s)","Album Name","Duration (ms)","ISRC"',
      '"spotify:track:1","Blinding Lights","The Weeknd","After Hours","200040","USUG11904206"',
      '"spotify:track:2","Uptown Funk (feat. Bruno Mars)","Mark Ronson, Bruno Mars","Uptown Special","269666","GBARL1401524"',
    ].join('\n');
    const result = importCsv(csv);
    expect(result.mapping).toMatchObject({
      title: 'Track Name',
      artist: 'Artist Name(s)',
      album: 'Album Name',
      duration: 'Duration (ms)',
      isrc: 'ISRC',
    });
    expect(result.drafts).toHaveLength(2);
    expect(result.drafts[0]).toMatchObject({
      title: 'Blinding Lights',
      artist: 'The Weeknd',
      album: 'After Hours',
      durationMs: 200_040,
      isrc: 'USUG11904206',
    });
    expect(result.drafts[1]?.artist).toBe('Mark Ronson, Bruno Mars');
  });

  it('handles quoted fields with commas, quotes, and line breaks', () => {
    const csv = 'Title,Artist\n"Hello, Goodbye",The Beatles\n"The ""Real"" Slim Shady",Eminem\n"Line\nBreak",Someone\n';
    const { drafts } = importCsv(csv);
    expect(drafts.map((d) => d.title)).toEqual(['Hello, Goodbye', 'The "Real" Slim Shady', 'Line\nBreak']);
  });

  it('keeps UTF-8 text and strips a byte-order mark', () => {
    const { drafts, mapping } = importCsv('﻿Title,Artist\nDESPECHÁ,Rosalía\nBeggin\',Måneskin\n');
    expect(mapping.title).toBe('Title');
    expect(drafts.map((d) => d.artist)).toEqual(['Rosalía', 'Måneskin']);
  });

  it('accepts semicolon and tab delimited files', () => {
    expect(importCsv('Title;Artist\nHalo;Beyoncé\n').drafts[0]).toMatchObject({ title: 'Halo', artist: 'Beyoncé' });
    expect(importCsv('Title\tArtist\nHalo\tBeyoncé\n').drafts[0]).toMatchObject({ title: 'Halo', artist: 'Beyoncé' });
  });

  it('flags rows missing a title or artist and drops empty rows', () => {
    const { drafts, emptyRows } = importCsv('Title,Artist\nHalo,\n , \n,Beyoncé\n');
    expect(drafts).toHaveLength(2);
    expect(drafts[0]?.warning).toMatch(/Missing artist/);
    expect(drafts[1]?.warning).toMatch(/Missing title/);
    expect(emptyRows).toBe(1);
  });

  it('returns no drafts when columns cannot be detected, but exposes headers for manual mapping', () => {
    const result = importCsv('foo,bar\nHalo,Beyoncé\n');
    expect(result.drafts).toEqual([]);
    expect(result.table.headers).toEqual(['foo', 'bar']);
    const mapped = importCsv('foo,bar\nHalo,Beyoncé\n', { title: 'foo', artist: 'bar' });
    expect(mapped.drafts[0]).toMatchObject({ title: 'Halo', artist: 'Beyoncé' });
  });

  it('reports malformed rows', () => {
    const result = importCsv('Title,Artist\n"Unclosed,Someone\n');
    expect(result.table.errors.length).toBeGreaterThan(0);
  });

  it('parses mm:ss durations', () => {
    expect(importCsv('Title,Artist,Time\nHalo,Beyoncé,4:21\n').drafts[0]?.durationMs).toBe(261_000);
  });
});
