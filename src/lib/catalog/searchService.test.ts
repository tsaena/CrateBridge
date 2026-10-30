import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CatalogSearchService } from './searchService';
import { CatalogError, type CatalogProvider } from '../providers/types';
import { findMatches } from '../matching/matchTrack';
import { draftToTrack } from '../../state/workspace';
import { recording } from '../../test/fixtures';

function provider(impl: CatalogProvider['search']): CatalogProvider & { search: ReturnType<typeof vi.fn> } {
  return { id: 'itunes', name: 'Test', search: vi.fn(impl) };
}

const q = (term: string) => ({ term, country: 'US' });

describe('CatalogSearchService', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('spaces requests out instead of sending them all at once', async () => {
    const p = provider(async () => [recording()]);
    const service = new CatalogSearchService(p, { minIntervalMs: 3000 });
    const all = Promise.all(Array.from({ length: 5 }, (_, i) => service.search(q(`song ${i}`))));

    await vi.advanceTimersByTimeAsync(0);
    expect(p.search).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2999);
    expect(p.search).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(p.search).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(9000);
    expect(p.search).toHaveBeenCalledTimes(5);
    await expect(all).resolves.toHaveLength(5);
  });

  it('caches results and shares identical in-flight queries', async () => {
    const p = provider(async () => [recording()]);
    const service = new CatalogSearchService(p, { minIntervalMs: 0 });
    const [a, b] = await Promise.all([service.search(q('Blinding Lights')), service.search(q('blinding lights '))]);
    expect(a).toBe(b);
    await service.search(q('Blinding Lights'));
    expect(p.search).toHaveBeenCalledTimes(1);
    expect(service.cached(q('BLINDING LIGHTS'))).toBe(a);
    await service.search({ term: 'Blinding Lights', country: 'GB' });
    expect(p.search).toHaveBeenCalledTimes(2);
  });

  it('retries recoverable failures with backoff', async () => {
    let calls = 0;
    const p = provider(async () => {
      calls += 1;
      if (calls < 3) throw new CatalogError('server', 'boom', 503);
      return [recording()];
    });
    const service = new CatalogSearchService(p, { minIntervalMs: 0, retryBackoffMs: 1000 });
    const result = service.search(q('x'));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toBe(2);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(result).resolves.toHaveLength(1);
    expect(calls).toBe(3);
  });

  it('pauses the whole queue when rate limited', async () => {
    let calls = 0;
    const p = provider(async ({ term }) => {
      calls += 1;
      if (calls === 1) throw new CatalogError('rate_limited', 'slow down', 403);
      return [recording({ title: term })];
    });
    const service = new CatalogSearchService(p, { minIntervalMs: 0, rateLimitBackoffMs: 30_000 });
    const first = service.search(q('a'));
    const second = service.search(q('b'));
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(1);
    expect(service.limiter.snapshot().pausedUntil).toBeGreaterThan(Date.now());
    await vi.advanceTimersByTimeAsync(29_000);
    expect(calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(first).resolves.toHaveLength(1);
    await expect(second).resolves.toHaveLength(1);
  });

  it('gives up after the retry limit and does not cache failures', async () => {
    const p = provider(async () => {
      throw new CatalogError('network', 'offline');
    });
    const service = new CatalogSearchService(p, { minIntervalMs: 0, retryBackoffMs: 10, maxRetries: 2 });
    const result = service.search(q('x'));
    const assertion = expect(result).rejects.toMatchObject({ kind: 'network' });
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    expect(p.search).toHaveBeenCalledTimes(3);
    expect(service.cached(q('x'))).toBeUndefined();
  });

  it('does not retry non-recoverable errors', async () => {
    const p = provider(async () => {
      throw new CatalogError('bad_response', 'bad');
    });
    const service = new CatalogSearchService(p, { minIntervalMs: 0 });
    await expect(service.search(q('x'))).rejects.toMatchObject({ kind: 'bad_response' });
    expect(p.search).toHaveBeenCalledTimes(1);
  });

  it('drops queued requests that are cancelled before they start', async () => {
    const p = provider(async () => [recording()]);
    const service = new CatalogSearchService(p, { minIntervalMs: 3000 });
    const controller = new AbortController();
    const first = service.search(q('a'));
    const cancelled = service.search(q('b'), { signal: controller.signal });
    const assertion = expect(cancelled).rejects.toMatchObject({ kind: 'aborted' });
    controller.abort();
    await assertion;
    await vi.advanceTimersByTimeAsync(10_000);
    await first;
    expect(p.search).toHaveBeenCalledTimes(1);
  });

  it('lets priority requests jump the queue', async () => {
    const order: string[] = [];
    const p = provider(async ({ term }) => {
      order.push(term);
      return [];
    });
    const service = new CatalogSearchService(p, { minIntervalMs: 1000 });
    const jobs = [service.search(q('a')), service.search(q('b')), service.search(q('c'), { priority: true })];
    await vi.advanceTimersByTimeAsync(5000);
    await Promise.all(jobs);
    expect(order).toEqual(['a', 'c', 'b']);
  });
});

describe('findMatches', () => {
  it('falls back to a broader query when the first finds nothing', async () => {
    const p = provider(async ({ term }) => (term === 'Purple Disco Machine Hypnotized' ? [recording({ artist: 'Purple Disco Machine', title: 'Hypnotized' })] : []));
    const service = new CatalogSearchService(p, { minIntervalMs: 0 });
    const track = draftToTrack({ artist: 'Purple Disco Machine', title: 'Hypnotized (Extended Mix)' }, 'paste');
    const candidates = await findMatches(track, service, { country: 'US', preference: 'any' });
    expect(p.search.mock.calls.map((c) => c[0].term)).toEqual([
      'Purple Disco Machine Hypnotized Extended Mix',
      'Purple Disco Machine Hypnotized',
    ]);
    expect(candidates[0]?.confidence).toBe('review');
  });

  it('returns nothing when every query is empty', async () => {
    const service = new CatalogSearchService(provider(async () => []), { minIntervalMs: 0 });
    const track = draftToTrack({ artist: 'Nobody', title: 'Nothing' }, 'paste');
    await expect(findMatches(track, service, { country: 'US', preference: 'any' })).resolves.toEqual([]);
  });
});
