/**
 * Owns the single sweep job inside the background worker: start / pause / resume / cancel /
 * retry / dismiss, plus crash recovery. I/O is injected so this is testable without a browser.
 */
import {
  createJob,
  isResumable,
  requeueFailed,
  runJob,
  type Control,
  type Job,
  type JobItem,
  type RunnerOptions,
} from './runner';
import type { ProviderId, SweepAction } from '../core/types';
import { ProviderError } from '../providers/types';

export interface ControllerDeps {
  load(): Promise<Job | null>;
  store(job: Job | null): Promise<void>;
  act(item: JobItem, job: Job): Promise<void>;
  sleep(ms: number): Promise<void>;
  now(): number;
  /** Called after a run stops for any reason (e.g. to drop swept chats from the cache). */
  onRunEnd?(job: Job): Promise<void>;
  runnerOptions?: Partial<RunnerOptions>;
}

export class JobController {
  private control: Control = 'run';
  private running: Promise<Job> | null = null;

  constructor(private deps: ControllerDeps) {}

  /** A job left "running" after a worker restart was interrupted; make it resumable. */
  async recover(): Promise<void> {
    if (this.running) return;
    const job = await this.deps.load();
    if (job?.status === 'running') {
      await this.deps.store({
        ...job,
        status: 'interrupted',
        note: 'ChatSweep was restarted mid-sweep. Press Resume to continue where it stopped.',
      });
    }
  }

  get isRunning(): boolean {
    return this.running !== null;
  }

  async start(init: {
    provider: ProviderId;
    action: SweepAction;
    tabId: number;
    items: Array<{ id: string; title: string }>;
  }): Promise<Job> {
    this.assertIdle();
    if (init.items.length === 0) throw new ProviderError('unknown', 'Nothing to sweep.');
    const job = { ...createJob(init, this.deps.now()), tabId: init.tabId };
    return this.launch(job);
  }

  async resume(): Promise<Job> {
    this.assertIdle();
    const job = await this.deps.load();
    if (!isResumable(job)) throw new ProviderError('unknown', 'There is no paused sweep to resume.');
    return this.launch(job!);
  }

  async retryFailed(): Promise<Job> {
    this.assertIdle();
    const job = await this.deps.load();
    if (!job || !job.items.some((i) => i.status === 'failed')) {
      throw new ProviderError('unknown', 'There are no failed chats to retry.');
    }
    return this.launch(requeueFailed(job));
  }

  /** Takes effect between items. */
  async pause(): Promise<Job | null> {
    if (this.running) this.control = 'pause';
    return this.deps.load();
  }

  async cancel(): Promise<Job | null> {
    if (this.running) {
      this.control = 'cancel';
      return this.deps.load();
    }
    const job = await this.deps.load();
    if (job && (job.status === 'paused' || job.status === 'interrupted')) {
      const cancelled: Job = { ...job, status: 'cancelled', note: 'Cancelled. Remaining chats were not touched.' };
      await this.deps.store(cancelled);
      return cancelled;
    }
    return job;
  }

  async dismiss(): Promise<null> {
    this.assertIdle();
    await this.deps.store(null);
    return null;
  }

  /** Resolves when the current run (if any) stops. For tests and orderly shutdown. */
  async settled(): Promise<Job | null> {
    return this.running ? this.running : this.deps.load();
  }

  private assertIdle() {
    if (this.running) throw new ProviderError('unknown', 'A sweep is already running.');
  }

  private launch(job: Job): Promise<Job> {
    this.control = 'run';
    const started: Job = { ...job, status: 'running' };
    const run = runJob(
      started,
      {
        act: (item, j) => this.deps.act(item, j),
        save: (j) => this.deps.store(j),
        sleep: (ms) => this.deps.sleep(ms),
        control: () => this.control,
        now: () => this.deps.now(),
      },
      this.deps.runnerOptions,
    )
      .catch(async (err: unknown) => {
        // Defensive: runJob catches item errors itself, so this means storage or a bug.
        const latest = (await this.deps.load().catch(() => null)) ?? started;
        const paused: Job = { ...latest, status: 'paused', note: `Stopped unexpectedly: ${(err as Error)?.message ?? err}` };
        await this.deps.store(paused).catch(() => {});
        return paused;
      })
      .then(async (final) => {
        await this.deps.onRunEnd?.(final).catch(() => {});
        return final;
      })
      .finally(() => {
        this.running = null;
        this.control = 'run';
      });
    this.running = run;
    // Return the freshly started state immediately; callers watch storage for progress.
    return Promise.resolve(started);
  }
}
