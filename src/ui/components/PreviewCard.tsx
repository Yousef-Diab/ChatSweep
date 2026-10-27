import { useMemo, useState } from 'react';
import type { PlanSummary } from '../../core/planner';
import type { Decision, Overrides, Verdict } from '../../core/types';
import { nf, relativeTime } from '../format';

type Filter = 'sweep' | 'keep' | 'all';
const PAGE = 150;

export function PreviewCard(props: {
  decisions: Decision[];
  summary: PlanSummary;
  overrides: Overrides;
  pinned: ReadonlySet<string>;
  onOverride: (id: string, verdict: Verdict | null) => void;
  onTogglePin: (id: string) => void;
  onClearOverrides: () => void;
}) {
  const { decisions, summary, overrides, pinned, onOverride, onTogglePin, onClearOverrides } = props;
  const [filter, setFilter] = useState<Filter>('sweep');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);

  const visible = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return decisions.filter(
      (d) => (filter === 'all' || d.verdict === filter) && (!q || d.chat.title.toLocaleLowerCase().includes(q)),
    );
  }, [decisions, filter, query]);

  const manualCount = Object.keys(overrides).length;

  return (
    <section className="card space-y-2">
      <div className="flex items-baseline justify-between">
        <h2 className="font-semibold">Preview</h2>
        {manualCount > 0 && (
          <button
            className="text-xs text-brand-600 hover:underline"
            onClick={onClearOverrides}
          >
            Clear {manualCount} manual choice(s)
          </button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
        {(
          [
            ['sweep', `Sweep ${nf.format(summary.sweep)}`],
            ['keep', `Keep ${nf.format(summary.keep)}`],
            ['all', `All ${nf.format(summary.total)}`],
          ] as const
        ).map(([key, text]) => (
          <button
            key={key}
            onClick={() => {
              setFilter(key);
              setLimit(PAGE);
            }}
            className={`rounded-md px-2 py-1 text-xs font-medium ${
              filter === key ? 'bg-white shadow-sm dark:bg-zinc-950' : 'text-zinc-600 dark:text-zinc-400'
            }`}
          >
            {text}
          </button>
        ))}
      </div>

      <input
        className="input"
        placeholder="Search titles…"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setLimit(PAGE);
        }}
      />

      {visible.length === 0 ? (
        <p className="label py-4 text-center">Nothing here.</p>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {visible.slice(0, limit).map((d) => (
            <Row
              key={d.chat.id}
              decision={d}
              manual={overrides[d.chat.id]}
              pinned={pinned.has(d.chat.id)}
              onOverride={onOverride}
              onTogglePin={onTogglePin}
            />
          ))}
        </ul>
      )}

      {visible.length > limit && (
        <button className="btn btn-ghost w-full" onClick={() => setLimit((l) => l + PAGE)}>
          Show more ({nf.format(visible.length - limit)} left)
        </button>
      )}
    </section>
  );
}

function Row(props: {
  decision: Decision;
  manual: Verdict | undefined;
  pinned: boolean;
  onOverride: (id: string, verdict: Verdict | null) => void;
  onTogglePin: (id: string) => void;
}) {
  const { decision: d, manual, pinned, onOverride, onTogglePin } = props;
  const protectedByRule = d.verdict === 'keep' && d.reasons.some((r) => r.code.startsWith('protected') || r.code === 'unknown-date');
  const lockedKeep = protectedByRule && manual !== 'keep';
  const sweep = d.verdict === 'sweep';

  const toggle = () => {
    if (manual) onOverride(d.chat.id, null);
    else onOverride(d.chat.id, sweep ? 'keep' : 'sweep');
  };

  return (
    <li className="flex items-start gap-2 py-1.5">
      <button
        onClick={toggle}
        disabled={lockedKeep}
        title={
          lockedKeep
            ? 'Protected by a rule. Change the rule or unpin to sweep it.'
            : manual
              ? 'Manual choice: click to undo'
              : sweep
                ? 'Click to keep this chat'
                : 'Click to sweep this chat'
        }
        className={`mt-0.5 w-14 shrink-0 rounded-md px-1 py-0.5 text-[11px] font-semibold disabled:cursor-not-allowed ${
          sweep
            ? 'bg-red-100 text-red-700 dark:bg-red-950/60 dark:text-red-300'
            : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
        } ${manual ? 'ring-2 ring-brand-500' : ''}`}
      >
        {sweep ? 'Sweep' : 'Keep'}
      </button>

      <div className="min-w-0 flex-1">
        <div className="truncate" title={d.chat.title}>
          {d.chat.title}
        </div>
        <div className="truncate text-[11px] text-zinc-500">
          {relativeTime(d.chat.updatedAt)} · {d.reasons.map((r) => r.label).join(' · ')}
        </div>
      </div>

      <button
        onClick={() => onTogglePin(d.chat.id)}
        title={pinned ? 'Unpin' : 'Pin: always keep this chat'}
        className={`shrink-0 text-sm ${pinned ? '' : 'opacity-25 grayscale hover:opacity-70'}`}
      >
        📌
      </button>
    </li>
  );
}
