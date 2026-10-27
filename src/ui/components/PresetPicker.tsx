import { useState } from 'react';
import { applyPreset, BUILT_IN_PRESETS, createPreset, findMatchingPreset, type Preset } from '../../core/presets';
import type { RuleSet } from '../../core/types';

export function PresetPicker(props: {
  rules: RuleSet;
  userPresets: Preset[];
  onApply: (rules: RuleSet) => void;
  onSaveUserPresets: (presets: Preset[]) => void;
}) {
  const { rules, userPresets, onApply, onSaveUserPresets } = props;
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const all = [...BUILT_IN_PRESETS, ...userPresets];
  const current = findMatchingPreset(rules, all);

  const save = () => {
    if (!name.trim()) return;
    const preset = createPreset(name, rules, Date.now());
    onSaveUserPresets([...userPresets.filter((p) => p.name !== preset.name), preset]);
    setNaming(false);
    setName('');
  };

  if (naming) {
    return (
      <div className="flex gap-1">
        <input
          className="input"
          autoFocus
          placeholder="Preset name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') setNaming(false);
          }}
        />
        <button className="btn btn-primary" onClick={save} disabled={!name.trim()}>
          Save
        </button>
        <button className="btn btn-ghost" onClick={() => setNaming(false)}>
          ✕
        </button>
      </div>
    );
  }

  return (
    <div className="flex gap-1">
      <select
        className="input"
        aria-label="Preset"
        value={current?.id ?? ''}
        onChange={(e) => {
          const p = all.find((x) => x.id === e.target.value);
          if (p) onApply(applyPreset(rules, p));
        }}
      >
        <option value="" disabled>
          Custom rules
        </option>
        <optgroup label="Built-in">
          {BUILT_IN_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </optgroup>
        {userPresets.length > 0 && (
          <optgroup label="Saved">
            {userPresets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {current && !current.builtIn ? (
        <button
          className="btn btn-ghost shrink-0"
          title={`Delete preset "${current.name}"`}
          onClick={() => onSaveUserPresets(userPresets.filter((p) => p.id !== current.id))}
        >
          Delete
        </button>
      ) : (
        <button className="btn btn-ghost shrink-0" disabled={!!current} onClick={() => setNaming(true)}>
          Save as…
        </button>
      )}
    </div>
  );
}
