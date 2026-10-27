import type { ProviderCapabilities, RuleSet } from '../../core/types';

export function RulesCard(props: {
  rules: RuleSet;
  capabilities: ProviderCapabilities;
  problems: string[];
  onChange: (rules: RuleSet) => void;
  presetSlot?: React.ReactNode;
}) {
  const { rules, capabilities, problems, onChange, presetSlot } = props;
  const set = <K extends keyof RuleSet>(key: K, value: RuleSet[K]) => onChange({ ...rules, [key]: value });
  const int = (v: string) => Math.max(0, Math.floor(Number(v) || 0));

  return (
    <section className="card space-y-3">
      <h2 className="font-semibold">Keep rules</h2>
      {presetSlot}

      {/* items-end: inputs stay aligned even when one label wraps in a narrow side panel */}
      <div className="grid grid-cols-2 items-end gap-2">
        <label className="space-y-1">
          <span className="label">Keep latest chats</span>
          <input
            className="input"
            type="number"
            min={0}
            value={rules.keepLatest}
            onChange={(e) => set('keepLatest', int(e.target.value))}
          />
        </label>
        <label className="space-y-1">
          <span className="label">Keep if active in last … days</span>
          <input
            className="input"
            type="number"
            min={0}
            value={rules.keepRecentDays}
            onChange={(e) => set('keepRecentDays', int(e.target.value))}
          />
        </label>
      </div>
      <p className="label -mt-1">0 turns a rule off.</p>

      <label className="block space-y-1">
        <span className="label">Always keep titles containing (one per line, or /regex/i)</span>
        <textarea
          className="input min-h-16 font-mono text-xs"
          placeholder={'invoice\npassport\n/^tax \\d{4}/i'}
          value={rules.protectTitlePatterns.join('\n')}
          onChange={(e) => set('protectTitlePatterns', e.target.value.split('\n'))}
        />
      </label>

      <div className="space-y-1">
        {capabilities.projects && (
          <Toggle checked={rules.protectProjects} onChange={(v) => set('protectProjects', v)}>
            Always keep chats inside Projects
          </Toggle>
        )}
        {capabilities.assistants && (
          <Toggle checked={rules.protectAssistants} onChange={(v) => set('protectAssistants', v)}>
            Always keep chats with custom GPTs
          </Toggle>
        )}
        {capabilities.star && (
          <Toggle checked={rules.protectStarred} onChange={(v) => set('protectStarred', v)}>
            Always keep pinned / starred chats
          </Toggle>
        )}
      </div>

      {rules.protectedIds.length > 0 && (
        <div className="flex items-center justify-between">
          <span className="label">📌 {rules.protectedIds.length} chat(s) pinned in ChatSweep</span>
          <button className="text-xs text-brand-600 hover:underline" onClick={() => set('protectedIds', [])}>
            Unpin all
          </button>
        </div>
      )}

      {problems.length > 0 && (
        <ul className="space-y-0.5 rounded-lg bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Toggle(props: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex cursor-pointer items-center gap-2">
      <input
        type="checkbox"
        className="accent-brand-600"
        checked={props.checked}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      <span>{props.children}</span>
    </label>
  );
}
