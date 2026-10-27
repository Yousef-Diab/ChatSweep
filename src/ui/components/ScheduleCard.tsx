import { SCHEDULE_CHOICES, type PendingReview, type Schedule } from '../../core/schedule';
import type { ProviderInfo } from '../../providers/registry';
import { plural, relativeTime } from '../format';

export function ScheduleCard(props: {
  provider: ProviderInfo;
  schedule: Schedule;
  onChange: (s: Schedule) => void;
  onCheckNow: () => void;
  checking: boolean;
  canCheck: boolean;
}) {
  const { provider, schedule, onChange, onCheckNow, checking, canCheck } = props;
  return (
    <section className="card space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Scheduled check</h2>
        <button className="btn btn-ghost" onClick={onCheckNow} disabled={!canCheck || checking}>
          {checking ? 'Checking…' : 'Check now'}
        </button>
      </div>
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          className="accent-brand-600"
          checked={schedule.enabled}
          onChange={(e) => onChange({ ...schedule, enabled: e.target.checked })}
        />
        <span>Check automatically every</span>
        <select
          className="input w-auto py-0.5"
          aria-label="Check interval"
          value={schedule.everyDays}
          onChange={(e) => onChange({ ...schedule, everyDays: Number(e.target.value) })}
        >
          {SCHEDULE_CHOICES.map((d) => (
            <option key={d} value={d}>
              {d === 1 ? 'day' : `${d} days`}
            </option>
          ))}
        </select>
      </label>
      <p className="label">
        ChatSweep never sweeps on its own. A check only counts the chats your rules would sweep, shows the number on the
        toolbar icon, and waits for you to confirm. A {provider.displayName} tab must be open when the check runs.
      </p>
    </section>
  );
}

export function PendingBanner(props: {
  provider: ProviderInfo;
  pending: PendingReview;
  onDismiss: () => void;
}) {
  const { provider, pending, onDismiss } = props;
  const when = relativeTime(pending.checkedAt);

  let tone = 'border-brand-500/50 bg-brand-50 dark:bg-brand-700/20';
  let text: React.ReactNode;
  if (pending.status === 'ready') {
    text =
      pending.count > 0 ? (
        <>
          <strong>Scheduled check ({when}):</strong> {plural(pending.count, 'chat')} match your rules. Review the preview
          below and confirm to {pending.action} them.
        </>
      ) : (
        <>
          <strong>Scheduled check ({when}):</strong> nothing to sweep. 🎉
        </>
      );
  } else if (pending.status === 'needs-tab') {
    tone = 'border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30';
    text = (
      <>
        <strong>Scheduled check ({when}) couldn’t run:</strong> no {provider.displayName} tab was open. Open one and press
        “Check now”.
      </>
    );
  } else {
    tone = 'border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30';
    text = (
      <>
        <strong>Scheduled check ({when}) failed:</strong> {pending.message}
      </>
    );
  }

  return (
    <div role="status" className={`card flex items-start gap-2 text-xs ${tone}`}>
      <span className="flex-1">{text}</span>
      <button className="shrink-0 text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200" onClick={onDismiss} title="Dismiss">
        ✕
      </button>
    </div>
  );
}
