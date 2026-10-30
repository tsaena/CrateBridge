import { CatalogError } from '../providers/types';

export interface RateLimiterOptions {
  /** Minimum time between the start of two requests. */
  minIntervalMs: number;
  now?: () => number;
}

export interface RateLimiterSnapshot {
  waiting: number;
  active: boolean;
  /** Epoch ms until which requests are held back after a rate-limit response. */
  pausedUntil: number;
}

interface Job {
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

/**
 * Runs async jobs one at a time with a minimum spacing between starts, so a
 * 100-track import becomes a steady trickle of requests instead of a burst.
 */
export class RateLimiter {
  private readonly queue: Job[] = [];
  private readonly listeners = new Set<(snapshot: RateLimiterSnapshot) => void>();
  private readonly now: () => number;
  private minIntervalMs: number;
  private lastStart = Number.NEGATIVE_INFINITY;
  private pausedUntil = 0;
  private active = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: RateLimiterOptions) {
    this.minIntervalMs = options.minIntervalMs;
    this.now = options.now ?? Date.now;
  }

  schedule<T>(run: () => Promise<T>, options: { signal?: AbortSignal; priority?: boolean } = {}): Promise<T> {
    const { signal, priority } = options;
    if (signal?.aborted) return Promise.reject(new CatalogError('aborted', 'Search cancelled.'));
    return new Promise<T>((resolve, reject) => {
      const job: Job = { run, resolve: resolve as (value: unknown) => void, reject, signal };
      if (signal) {
        job.onAbort = () => {
          const index = this.queue.indexOf(job);
          if (index >= 0) {
            this.queue.splice(index, 1);
            reject(new CatalogError('aborted', 'Search cancelled.'));
            this.emit();
          }
        };
        signal.addEventListener('abort', job.onAbort, { once: true });
      }
      if (priority) this.queue.unshift(job);
      else this.queue.push(job);
      this.emit();
      this.pump();
    });
  }

  /** Hold all requests until `until` (epoch ms), e.g. after Apple signals rate limiting. */
  pauseUntil(until: number): void {
    this.pausedUntil = Math.max(this.pausedUntil, until);
    this.emit();
    this.pump();
  }

  setMinInterval(ms: number): void {
    this.minIntervalMs = ms;
  }

  snapshot(): RateLimiterSnapshot {
    return { waiting: this.queue.length, active: this.active, pausedUntil: this.pausedUntil };
  }

  subscribe(listener: (snapshot: RateLimiterSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const snapshot = this.snapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }

  private pump(): void {
    if (this.active || this.timer !== undefined || this.queue.length === 0) return;
    const now = this.now();
    const readyAt = Math.max(this.lastStart + this.minIntervalMs, this.pausedUntil);
    if (readyAt > now) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.pump();
      }, readyAt - now);
      return;
    }
    const job = this.queue.shift();
    if (!job) return;
    if (job.signal && job.onAbort) job.signal.removeEventListener('abort', job.onAbort);
    this.active = true;
    this.lastStart = now;
    this.emit();
    job
      .run()
      .then(job.resolve, job.reject)
      .finally(() => {
        this.active = false;
        this.emit();
        this.pump();
      });
  }
}
