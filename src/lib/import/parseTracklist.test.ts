import { describe, expect, it } from 'vitest';
import { parseLine, parseTracklist } from './parseTracklist';
import { SAMPLE_PLAYLIST } from '../../data/samplePlaylist';

const pair = (text: string) => {
  const line = parseLine(text, 1);
  return [line.artist, line.title];
};

describe('parseTracklist', () => {
  it('parses standard "Artist - Title" lines', () => {
    expect(pair('The Weeknd - Blinding Lights')).toEqual(['The Weeknd', 'Blinding Lights']);
    expect(pair('Usher - Yeah!')).toEqual(['Usher', 'Yeah!']);
  });

  it('accepts en dashes, em dashes, and unspaced long dashes', () => {
    expect(pair('Lady Gaga – Poker Face')).toEqual(['Lady Gaga', 'Poker Face']);
    expect(pair('Daft Punk — One More Time')).toEqual(['Daft Punk', 'One More Time']);
    expect(pair('Daft Punk—One More Time')).toEqual(['Daft Punk', 'One More Time']);
  });

  it('does not split on hyphens inside names', () => {
    expect(pair('Jay-Z - 99 Problems')).toEqual(['Jay-Z', '99 Problems']);
    expect(pair('Ne-Yo – So Sick')).toEqual(['Ne-Yo', 'So Sick']);
  });

  it('keeps Unicode names intact', () => {
    expect(pair('Beyoncé - Halo')).toEqual(['Beyoncé', 'Halo']);
    expect(pair('Sigur Rós – Hoppípolla')).toEqual(['Sigur Rós', 'Hoppípolla']);
    expect(pair('宇多田ヒカル - First Love')).toEqual(['宇多田ヒカル', 'First Love']);
  });

  it('trims extra whitespace, tabs, and non-breaking spaces', () => {
    expect(pair('   The Killers    -     Mr. Brightside   ')).toEqual(['The Killers', 'Mr. Brightside']);
    expect(pair('Robyn - Dancing On My Own')).toEqual(['Robyn', 'Dancing On My Own']);
    expect(pair('Robyn\tDancing On My Own')).toEqual(['Robyn', 'Dancing On My Own']);
  });

  it('strips list numbering without eating numeric artist names', () => {
    expect(pair('1. The Weeknd - Blinding Lights')).toEqual(['The Weeknd', 'Blinding Lights']);
    expect(pair('02) Usher - Yeah!')).toEqual(['Usher', 'Yeah!']);
    expect(pair('#3 The Killers - Mr. Brightside')).toEqual(['The Killers', 'Mr. Brightside']);
    expect(pair('4 - Lady Gaga - Poker Face')).toEqual(['Lady Gaga', 'Poker Face']);
    expect(pair('• Daft Punk - One More Time')).toEqual(['Daft Punk', 'One More Time']);
    expect(pair('50 Cent - In Da Club')).toEqual(['50 Cent', 'In Da Club']);
    expect(pair('3 Doors Down - Kryptonite')).toEqual(['3 Doors Down', 'Kryptonite']);
    expect(pair('1. 50 Cent - In Da Club')).toEqual(['50 Cent', 'In Da Club']);
  });

  it('strips DJ timestamps and captures trailing durations', () => {
    const line = parseLine('[01:02:33] Avicii - Levels (3:20)', 1);
    expect([line.artist, line.title]).toEqual(['Avicii', 'Levels']);
    expect(line.durationMs).toBe(200_000);
    expect(pair('00:00 Avicii - Levels')).toEqual(['Avicii', 'Levels']);
  });

  it('skips blank lines and reports line numbers', () => {
    const result = parseTracklist('\n\nThe Weeknd - Blinding Lights\n\n   \nUsher - Yeah!\n');
    expect(result.lines).toHaveLength(2);
    expect(result.lines.map((l) => l.lineNumber)).toEqual([3, 6]);
    expect(result.skipped).toBe(5);
  });

  it('handles Windows line endings', () => {
    expect(parseTracklist('A - B\r\nC - D\r\n').lines.map((l) => l.title)).toEqual(['B', 'D']);
  });

  it('flags lines without a separator instead of guessing', () => {
    const line = parseLine('Blinding Lights', 1);
    expect(line.ok).toBe(false);
    expect(line.artist).toBe('');
    expect(line.title).toBe('Blinding Lights');
    expect(line.warning).toMatch(/separator/);
  });

  it('flags ambiguous multi-separator lines but accepts version suffixes', () => {
    const ambiguous = parseLine('Above & Beyond - Sun - Moon - Club Mix', 1);
    expect(ambiguous.ok).toBe(true);
    expect(ambiguous.warning).toMatch(/more than one separator/);

    const remaster = parseLine('Fleetwood Mac - Dreams - 2004 Remaster', 1);
    expect([remaster.artist, remaster.title]).toEqual(['Fleetwood Mac', 'Dreams - 2004 Remaster']);
    expect(remaster.warning).toBeUndefined();
  });

  it('supports "Title - Artist" order when requested', () => {
    expect(parseLine('Blinding Lights - The Weeknd', 1, 'title-artist')).toMatchObject({
      artist: 'The Weeknd',
      title: 'Blinding Lights',
    });
  });

  it('reads "Title by Artist" with a warning', () => {
    const line = parseLine('Blinding Lights by The Weeknd', 1);
    expect(line).toMatchObject({ ok: true, artist: 'The Weeknd', title: 'Blinding Lights' });
    expect(line.warning).toBeDefined();
  });

  it('explains that streaming links cannot be resolved', () => {
    const line = parseLine('https://open.spotify.com/track/0VjIjW4GlUZAMYd2vXMi3b', 1);
    expect(line.ok).toBe(false);
    expect(line.warning).toMatch(/Links can’t be resolved/);
  });

  it('removes wrapping quotes but keeps apostrophes', () => {
    expect(pair('"Outkast - Hey Ya!"')).toEqual(['Outkast', 'Hey Ya!']);
    expect(pair('“Outkast - Hey Ya!”')).toEqual(['Outkast', 'Hey Ya!']);
    expect(pair("Måneskin - Beggin'")).toEqual(['Måneskin', "Beggin'"]);
    expect(pair("'Til Tuesday - Voices Carry")).toEqual(["'Til Tuesday", 'Voices Carry']);
  });

  it('parses the bundled sample playlist without problems', () => {
    const { lines } = parseTracklist(SAMPLE_PLAYLIST);
    expect(lines.length).toBeGreaterThanOrEqual(20);
    expect(lines.every((l) => l.ok && l.artist && l.title)).toBe(true);
    expect(lines.filter((l) => l.warning)).toEqual([]);
  });
});
