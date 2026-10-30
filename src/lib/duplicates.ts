import type { PurchaseStatus, Track } from '../types';
import { SOFT_VERSION_TAGS, analyzeTitle, normalizeText, primaryArtist } from './normalize';

/**
 * Two tracks are duplicates when their primary artist, core title, and
 * version tags all agree. "Summer" and "Summer (Extended Mix)" are kept as
 * legitimate alternate versions.
 */
export function duplicateKey(artist: string, title: string): string {
  const analysis = analyzeTitle(title);
  const hardTags = analysis.tags.filter((t) => !SOFT_VERSION_TAGS.has(t)).sort();
  return [normalizeText(primaryArtist(artist)), analysis.core, hardTags.join('+'), analysis.qualifierTokens.join(' ')].join('|');
}

/** Looser key for spotting other versions of the same song. */
export function songKey(artist: string, title: string): string {
  return `${normalizeText(primaryArtist(artist))}|${analyzeTitle(title).core}`;
}

export interface DuplicateGroup {
  key: string;
  /** Track to keep: the most progressed status, then the earliest import. */
  keep: Track;
  remove: Track[];
}

const STATUS_RANK: Record<PurchaseStatus, number> = {
  purchased: 3,
  found: 2,
  skipped: 1,
  not_started: 0,
};

export function findDuplicates(tracks: Track[]): DuplicateGroup[] {
  const groups = new Map<string, Track[]>();
  for (const track of tracks) {
    if (!track.title.trim()) continue;
    const key = duplicateKey(track.artist, track.title);
    groups.set(key, [...(groups.get(key) ?? []), track]);
  }

  const result: DuplicateGroup[] = [];
  for (const [key, members] of groups) {
    if (members.length < 2) continue;
    const ordered = [...members].sort(
      (a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status] || tracks.indexOf(a) - tracks.indexOf(b),
    );
    const [keep, ...remove] = ordered;
    if (keep) result.push({ key, keep, remove });
  }
  return result;
}

/** Ids of every track that shares a song (any version) with another track. */
export function findAlternateVersions(tracks: Track[]): Set<string> {
  const bySong = new Map<string, Track[]>();
  for (const track of tracks) {
    const key = songKey(track.artist, track.title);
    bySong.set(key, [...(bySong.get(key) ?? []), track]);
  }
  const ids = new Set<string>();
  for (const members of bySong.values()) {
    const distinct = new Set(members.map((t) => duplicateKey(t.artist, t.title)));
    if (distinct.size > 1) members.forEach((t) => ids.add(t.id));
  }
  return ids;
}
