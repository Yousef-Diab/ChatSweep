import { describe, expect, it } from 'vitest';
import { JobController } from '../../src/jobs/controller';
import { countJob, type Job, type JobItem } from '../../src/jobs/runner';
import { ProviderError } from '../../src/providers/types';

function setup(act: (item: JobItem) => Promise<void> | void = () => {}, initial: Job | null = null) {
  let stored: Job | null = initial;
  const ended: Job[] = [];
  let gate: (() => void) | null = null;
  let t = 0;
  const ctl = new JobController({
    load: async () => (stored ? structuredClone(stored) : null),
    store: async (j) => {
      stored = j ? structuredClone(j) : null;
    },
    act: async (item) => act(item),
    // Sleeps block until the test releases them, so we can pause/cancel mid-run.
    sleep: () =>
      new Promise<void>((r) => {
        gate = r;
      }),
    now: () => ++t,
    onRunEnd: async (j) => {
      ended.push(j);
    },
  });
  return {
    ctl,
    get stored() {
      return stored;
    },
    ended,
    release: () => {
      const g = gate;
      gate = null;
      g?.();
    },
  };
}

const items = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, title: `t${i}` }));
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('JobController', () => {
  it('runs a job to completion and reports the end', async () => {
    const h = setup();
    await h.ctl.start({ provider: 'chatgpt', action: 'archive', tabId: 7, items: items(2) });
    await tick();
    h.release(); // the delay between item 1 and 2
    const final = await h.ctl.settled();
    expect(final!.status).toBe('completed');
    expect(h.stored!.tabId).toBe(7);
    expect(h.ended).toHaveLength(1);
    expect(h.ctl.isRunning).toBe(false);
  });

  it('refuses to start a second job while one is running, or an empty one', async () => {
    const h = setup();
    await h.ctl.start({ provider: 'chatgpt', action: 'archive', tabId: 1, items: items(2) });
    await expect(h.ctl.start({ provider: 'chatgpt', action: 'archive', tabId: 1, items: items(1) })).rejects.toThrow(
      /already running/,
    );
    await tick();
    h.release();
    await h.ctl.settled();
    await expect(h.ctl.start({ provider: 'chatgpt', action: 'archive', tabId: 1, items: [] })).rejects.toThrow(
      /Nothing/,
    );
  });

  it('pauses between items and resumes the rest', async () => {
    const h = setup();
    await h.ctl.start({ provider: 'chatgpt', action: 'archive', tabId: 1, items: items(3) });
    await tick();
    await h.ctl.pause();
    h.release();
    const paused = await h.ctl.settled();
    expect(paused!.status).toBe('paused');
    expect(countJob(paused!)).toMatchObject({ done: 1, pending: 2 });

    await h.ctl.resume();
    await tick();
    h.release();
    const done = await h.ctl.settled();
    expect(done!.status).toBe('completed');
    expect(countJob(done!).done).toBe(3);
  });

  it('cancels a running job, and a paused one directly', async () => {
    const h = setup();
    await h.ctl.start({ provider: 'chatgpt', action: 'delete', tabId: 1, items: items(3) });
    await tick();
    await h.ctl.cancel();
    h.release();
    expect((await h.ctl.settled())!.status).toBe('cancelled');

    const paused: Job = { ...h.stored!, status: 'paused' };
    const h2 = setup(undefined, paused);
    expect((await h2.ctl.cancel())!.status).toBe('cancelled');
  });

  it('recovers a job left "running" by a dead worker as interrupted + resumable', async () => {
    const h = setup();
    await h.ctl.start({ provider: 'chatgpt', action: 'archive', tabId: 1, items: items(2) });
    await tick();
    const orphan = { ...h.stored!, status: 'running' as const };

    const fresh = setup(undefined, orphan);
    await fresh.ctl.recover();
    expect(fresh.stored!.status).toBe('interrupted');
    await fresh.ctl.resume();
    await tick();
    fresh.release();
    expect((await fresh.ctl.settled())!.status).toBe('completed');
    h.release();
  });

  it('retries only failed items', async () => {
    let fail = true;
    const acted: string[] = [];
    const h = setup((item) => {
      acted.push(item.id);
      if (fail && item.id === 'c0') throw new ProviderError('bad-response', 'nope');
    });
    await h.ctl.start({ provider: 'chatgpt', action: 'archive', tabId: 1, items: items(2) });
    await tick();
    h.release();
    const first = await h.ctl.settled();
    expect(countJob(first!)).toMatchObject({ done: 1, failed: 1 });

    fail = false;
    acted.length = 0;
    await h.ctl.retryFailed();
    const second = await h.ctl.settled();
    expect(acted).toEqual(['c0']);
    expect(countJob(second!)).toMatchObject({ done: 2, failed: 0 });
  });

  it('dismiss clears the stored job when idle', async () => {
    const h = setup();
    await h.ctl.start({ provider: 'chatgpt', action: 'archive', tabId: 1, items: items(1) });
    await h.ctl.settled();
    await h.ctl.dismiss();
    expect(h.stored).toBeNull();
  });
});
