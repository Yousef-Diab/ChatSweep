/**
 * The sweep job runner. Pure logic with injected side effects, so it is fully unit-testable;
 * the background worker supplies real `act` / `save` / `sleep` implementations.
 *
 * Guarantees:
 *  - Items run strictly one at a time, with `delayMs` between them.
 *  - State is saved after every item → a killed service worker loses at most one in-flight item,
 *    and that item is safe to retry (archive/delete are idempotent).
 *  - Rate limits slow the whole job down (adaptive delay) and retry with backoff.
 *  - Session problems pause the job instead of failing every remaining item.
 */
import type { ProviderId, SweepAction } from '../core/types';
import { toErrorInfo, type ProviderErrorInfo } from '../providers/types';

export type JobItemStatus = 'pending' | 'done' | 'failed';
export type JobStatus = 'running' | 'paused' | 'interrupted' | 'cancelled' | 'completed';

export interface JobItem {
  id: string;
  title: string;
  status: JobItemStatus;
  attempts: number;
  error?: string;
  note?: string;
}

export interface Job {
  id: string;
  provider: ProviderId;
  action: SweepAction;
  status: JobStatus;
  items: JobItem[];
  delayMs: number;
  createdAt: number;
  updatedAt: number;
  /** Why the job is paused / interrupted, shown to the user. */
  note?: string;
  /** Browser tab the requests run in (the runner itself never reads this). */
  tabId?: number;
}

export type Control = 'run' | 'pause' | 'cancel';

export interface RunnerDeps {
  act(item: JobItem, job: Job): Promise<void>;
  save(job: Job): Promise<void>;
  sleep(ms: number): Promise<void>;
  /** Read on every step, so pause/cancel take effect between items. */
  control(): Control;
  now(): number;
}

export interface RunnerOptions {
  maxAttempts: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RUNNER_OPTIONS: RunnerOptions = {
  maxAttempts: 5,
  baseBackoffMs: 2_000,
  maxBackoffMs: 60_000,
  maxDelayMs: 5_000,
};

export const DEFAULT_DELAY_MS = 400;

export function createJob(
  init: { provider: ProviderId; action: SweepAction; items: Array<{ id: string; title: string }>; delayMs?: number },
  now: number,
  id = `job-${now.toString(36)}`,
): Job {
  // Dedupe defensively: the same chat must never be acted on twice in one job.
  const unique = [...new Map(init.items.map((i) => [i.id, i])).values()];
  return {
    id,
    provider: init.provider,
    action: init.action,
    status: 'running',
    items: unique.map((i) => ({ id: i.id, title: i.title, status: 'pending', attempts: 0 })),
    delayMs: init.delayMs ?? DEFAULT_DELAY_MS,
    createdAt: now,
    updatedAt: now,
  };
}

const RETRYABLE = new Set(['rate-limited', 'server', 'network']);
const PAUSING = new Set(['unauthorized', 'not-logged-in', 'no-tab']);

export function backoffMs(attempt: number, err: ProviderErrorInfo, opts: RunnerOptions): number {
  if (err.retryAfterMs != null) return Math.min(Math.max(err.retryAfterMs, 0) + 250, opts.maxBackoffMs);
  return Math.min(opts.baseBackoffMs * 2 ** Math.max(0, attempt - 1), opts.maxBackoffMs);
}

/** Runs pending items until done, paused or cancelled. Returns the final job (also saved). */
export async function runJob(
  input: Job,
  deps: RunnerDeps,
  options: Partial<RunnerOptions> = {},
): Promise<Job> {
  const opts = { ...DEFAULT_RUNNER_OPTIONS, ...options };
  const job: Job = structuredClone(input);
  job.status = 'running';
  delete job.note;

  const persist = async () => {
    job.updatedAt = deps.now();
    await deps.save(structuredClone(job));
  };
  await persist();

  let first = true;
  for (const item of job.items) {
    if (item.status !== 'pending') continue;

    if (!first) await deps.sleep(job.delayMs);
    first = false;

    while (item.status === 'pending') {
      const control = deps.control();
      if (control === 'pause') {
        job.status = 'paused';
        job.note = 'Paused.';
        await persist();
        return job;
      }
      if (control === 'cancel') {
        job.status = 'cancelled';
        job.note = 'Cancelled. Remaining chats were not touched.';
        await persist();
        return job;
      }

      item.attempts += 1;
      try {
        await deps.act(item, job);
        item.status = 'done';
        delete item.error;
      } catch (raw) {
        const err = toErrorInfo(raw);

        if (err.code === 'not-found') {
          item.status = 'done';
          item.note = 'Already gone';
        } else if (PAUSING.has(err.code)) {
          item.attempts -= 1; // not the item's fault
          job.status = 'paused';
          job.note = err.message;
          await persist();
          return job;
        } else if (RETRYABLE.has(err.code) && item.attempts < opts.maxAttempts) {
          if (err.code === 'rate-limited') {
            job.delayMs = Math.min(Math.round(job.delayMs * 1.5), opts.maxDelayMs);
          }
          item.error = err.message;
          await persist();
          await deps.sleep(backoffMs(item.attempts, err, opts));
          continue;
        } else {
          item.status = 'failed';
          item.error = err.message;
        }
      }
    }
    await persist();
  }

  job.status = 'completed';
  await persist();
  return job;
}

/** Puts failed items back in the queue (for "Retry failed"). */
export function requeueFailed(job: Job): Job {
  return {
    ...job,
    items: job.items.map((i) =>
      i.status === 'failed' ? { ...i, status: 'pending' as const, attempts: 0, error: undefined } : i,
    ),
  };
}

export interface JobCounts {
  total: number;
  done: number;
  failed: number;
  pending: number;
}

export function countJob(job: Job): JobCounts {
  const c: JobCounts = { total: job.items.length, done: 0, failed: 0, pending: 0 };
  for (const i of job.items) c[i.status] += 1;
  return c;
}

export function isActive(job: Job | null | undefined): boolean {
  return !!job && job.status === 'running';
}

export function isResumable(job: Job | null | undefined): boolean {
  return !!job && (job.status === 'paused' || job.status === 'interrupted') && countJob(job).pending > 0;
}
