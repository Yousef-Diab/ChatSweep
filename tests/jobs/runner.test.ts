import { describe, expect, it } from 'vitest';
import {
  backoffMs,
  countJob,
  createJob,
  DEFAULT_RUNNER_OPTIONS,
  isResumable,
  requeueFailed,
  runJob,
  type Control,
  type Job,
  type JobItem,
} from '../../src/jobs/runner';
import { ProviderError } from '../../src/providers/types';

function items(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: `c${i}`, title: `Chat ${i}` }));
}

function harness(act: (item: JobItem, call: number) => Promise<void> | void, controls: Control[] = []) {
  const saved: Job[] = [];
  const sleeps: number[] = [];
  const acted: string[] = [];
  let calls = 0;
  let t = 1_000;
  return {
    saved,
    sleeps,
    acted,
    deps: {
      act: async (item: JobItem) => {
        acted.push(item.id);
        await act(item, calls++);
      },
      save: async (job: Job) => {
        saved.push(job);
      },
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
      control: () => controls.shift() ?? 'run',
      now: () => (t += 1),
    },
  };
}

describe('createJob', () => {
  it('dedupes items and starts everything pending', () => {
    const job = createJob({ provider: 'chatgpt', action: 'archive', items: [...items(2), items(1)[0]!] }, 5);
    expect(job.items.map((i) => i.id)).toEqual(['c0', 'c1']);
    expect(job.items.every((i) => i.status === 'pending' && i.attempts === 0)).toBe(true);
    expect(job.status).toBe('running');
  });
});

describe('runJob', () => {
  it('processes every item once, in order, with the delay between items', async () => {
    const h = harness(() => {});
    const job = await runJob(createJob({ provider: 'chatgpt', action: 'archive', items: items(3), delayMs: 400 }, 0), h.deps);
    expect(job.status).toBe('completed');
    expect(h.acted).toEqual(['c0', 'c1', 'c2']);
    expect(h.sleeps).toEqual([400, 400]);
    expect(countJob(job)).toEqual({ total: 3, done: 3, failed: 0, pending: 0 });
  });

  it('saves after every item so progress survives a crash', async () => {
    const h = harness(() => {});
    await runJob(createJob({ provider: 'chatgpt', action: 'archive', items: items(3) }, 0), h.deps);
    const doneCounts = h.saved.map((j) => countJob(j).done);
    expect(doneCounts).toEqual([0, 1, 2, 3, 3]);
  });

  it('retries rate limits with Retry-After and slows the whole job down', async () => {
    const h = harness((_item, call) => {
      if (call === 0) throw new ProviderError('rate-limited', 'slow down', 429, 3000);
    });
    const job = await runJob(createJob({ provider: 'chatgpt', action: 'delete', items: items(2), delayMs: 400 }, 0), h.deps);
    expect(job.status).toBe('completed');
    expect(h.acted).toEqual(['c0', 'c0', 'c1']);
    expect(h.sleeps).toEqual([3250, 600]); // backoff, then the slowed-down inter-item delay
    expect(job.delayMs).toBe(600);
    expect(job.items[0]).toMatchObject({ status: 'done', attempts: 2 });
  });

  it('marks an item failed after maxAttempts retryable errors and moves on', async () => {
    const h = harness((item) => {
      if (item.id === 'c0') throw new ProviderError('server', 'boom', 502);
    });
    const job = await runJob(createJob({ provider: 'chatgpt', action: 'archive', items: items(2) }, 0), h.deps, {
      maxAttempts: 3,
    });
    expect(job.items[0]).toMatchObject({ status: 'failed', attempts: 3, error: 'boom' });
    expect(job.items[1]!.status).toBe('done');
    expect(job.status).toBe('completed');
  });

  it('fails non-retryable errors immediately', async () => {
    const h = harness(() => {
      throw new ProviderError('bad-response', 'weird');
    });
    const job = await runJob(createJob({ provider: 'chatgpt', action: 'archive', items: items(1) }, 0), h.deps);
    expect(job.items[0]).toMatchObject({ status: 'failed', attempts: 1 });
  });

  it('treats not-found as done (already gone)', async () => {
    const h = harness(() => {
      throw new ProviderError('not-found', 'gone', 404);
    });
    const job = await runJob(createJob({ provider: 'chatgpt', action: 'delete', items: items(1) }, 0), h.deps);
    expect(job.items[0]).toMatchObject({ status: 'done', note: 'Already gone' });
  });

  it('pauses the whole job on session errors without burning an attempt', async () => {
    const h = harness((_i, call) => {
      if (call === 1) throw new ProviderError('unauthorized', 'Session expired', 401);
    });
    const job = await runJob(createJob({ provider: 'chatgpt', action: 'archive', items: items(3) }, 0), h.deps);
    expect(job.status).toBe('paused');
    expect(job.note).toBe('Session expired');
    expect(job.items.map((i) => i.status)).toEqual(['done', 'pending', 'pending']);
    expect(job.items[1]!.attempts).toBe(0);
    expect(isResumable(job)).toBe(true);
  });

  it('honours pause and cancel between items', async () => {
    const paused = harness(() => {}, ['run', 'pause']);
    const p = await runJob(createJob({ provider: 'chatgpt', action: 'archive', items: items(3) }, 0), paused.deps);
    expect(p.status).toBe('paused');
    expect(paused.acted).toEqual(['c0']);

    const cancelled = harness(() => {}, ['cancel']);
    const c = await runJob(createJob({ provider: 'chatgpt', action: 'archive', items: items(3) }, 0), cancelled.deps);
    expect(c.status).toBe('cancelled');
    expect(cancelled.acted).toEqual([]);
    expect(isResumable(c)).toBe(false);
  });

  it('resumes only the pending items', async () => {
    const first = harness(() => {}, ['run', 'pause']);
    const paused = await runJob(createJob({ provider: 'chatgpt', action: 'archive', items: items(3) }, 0), first.deps);
    const second = harness(() => {});
    const done = await runJob(paused, second.deps);
    expect(second.acted).toEqual(['c1', 'c2']);
    expect(done.status).toBe('completed');
  });

  it('does not mutate the input job', async () => {
    const input = createJob({ provider: 'chatgpt', action: 'archive', items: items(2) }, 0);
    const snapshot = JSON.stringify(input);
    await runJob(input, harness(() => {}).deps);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('does nothing for a job with no pending items', async () => {
    const job = createJob({ provider: 'chatgpt', action: 'archive', items: [] }, 0);
    const h = harness(() => {});
    expect((await runJob(job, h.deps)).status).toBe('completed');
    expect(h.acted).toEqual([]);
  });
});

describe('helpers', () => {
  it('backoff is exponential and capped; Retry-After wins', () => {
    const o = DEFAULT_RUNNER_OPTIONS;
    expect([1, 2, 3, 10].map((a) => backoffMs(a, { code: 'server', message: '' }, o))).toEqual([2000, 4000, 8000, 60000]);
    expect(backoffMs(1, { code: 'rate-limited', message: '', retryAfterMs: 5000 }, o)).toBe(5250);
    expect(backoffMs(1, { code: 'rate-limited', message: '', retryAfterMs: 999_999 }, o)).toBe(60000);
  });

  it('requeueFailed resets only failed items', () => {
    const job = createJob({ provider: 'chatgpt', action: 'archive', items: items(2) }, 0);
    job.items[0]!.status = 'failed';
    job.items[0]!.attempts = 5;
    job.items[1]!.status = 'done';
    const again = requeueFailed(job);
    expect(again.items.map((i) => [i.status, i.attempts])).toEqual([
      ['pending', 0],
      ['done', 0],
    ]);
  });
});
