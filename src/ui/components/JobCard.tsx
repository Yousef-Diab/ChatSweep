import { countJob, isResumable, type Job } from '../../jobs/runner';
import { nf } from '../format';

const STATUS_TEXT: Record<Job['status'], string> = {
  running: 'Sweeping…',
  paused: 'Paused',
  interrupted: 'Interrupted',
  cancelled: 'Cancelled',
  completed: 'Done',
};

export function JobCard(props: {
  job: Job;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const { job, onPause, onResume, onCancel, onRetry, onDismiss } = props;
  const c = countJob(job);
  const pct = c.total ? Math.round(((c.done + c.failed) / c.total) * 100) : 100;
  const failed = job.items.filter((i) => i.status === 'failed');
  const running = job.status === 'running';
  const verbPast = job.action === 'archive' ? 'archived' : 'deleted';

  return (
    <section className="card space-y-2 border-brand-500/40">
      <div className="flex items-baseline justify-between">
        <h2 className="font-semibold">{STATUS_TEXT[job.status]}</h2>
        <span className="label">
          {nf.format(c.done)} {verbPast}
          {c.failed > 0 && ` · ${nf.format(c.failed)} failed`} · {nf.format(c.total)} total
        </span>
      </div>

      <div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
        <div
          className={`h-full transition-all ${c.failed ? 'bg-amber-500' : 'bg-brand-600'}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {job.note && <p className="text-xs text-zinc-600 dark:text-zinc-400">{job.note}</p>}
      {running && job.delayMs > 600 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Rate-limited by the provider. Slowed to one chat every {(job.delayMs / 1000).toFixed(1)}s.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {running && (
          <>
            <button className="btn btn-ghost" onClick={onPause}>
              Pause
            </button>
            <button className="btn btn-ghost" onClick={onCancel}>
              Stop
            </button>
          </>
        )}
        {isResumable(job) && (
          <>
            <button className="btn btn-primary" onClick={onResume}>
              Resume ({nf.format(c.pending)} left)
            </button>
            <button className="btn btn-ghost" onClick={onCancel}>
              Cancel
            </button>
          </>
        )}
        {!running && failed.length > 0 && (
          <button className="btn btn-ghost" onClick={onRetry}>
            Retry {nf.format(failed.length)} failed
          </button>
        )}
        {!running && !isResumable(job) && (
          <button className="btn btn-ghost" onClick={onDismiss}>
            Dismiss
          </button>
        )}
      </div>

      {failed.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-zinc-600 dark:text-zinc-400">Failed chats</summary>
          <ul className="mt-1 max-h-40 space-y-0.5 overflow-auto">
            {failed.slice(0, 100).map((i) => (
              <li key={i.id} className="truncate" title={i.error}>
                {i.title} <span className="text-red-600 dark:text-red-400">· {i.error}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
