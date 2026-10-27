import { DEFAULT_RULES, type RuleSet } from './types';

/** A preset never carries pinned chat ids: pins are personal and survive preset switches. */
export type PresetRules = Omit<RuleSet, 'protectedIds'>;

export interface Preset {
  id: string;
  name: string;
  rules: PresetRules;
  builtIn?: boolean;
}

const base: PresetRules = (({ protectedIds: _ignored, ...rest }) => rest)(DEFAULT_RULES);

export const BUILT_IN_PRESETS: readonly Preset[] = [
  {
    id: 'builtin:gentle',
    name: 'Gentle: keep latest 50 + last 30 days',
    builtIn: true,
    rules: { ...base, keepLatest: 50, keepRecentDays: 30, protectAssistants: true },
  },
  {
    id: 'builtin:balanced',
    name: 'Balanced: keep latest 30',
    builtIn: true,
    rules: { ...base, keepLatest: 30, keepRecentDays: 0 },
  },
  {
    id: 'builtin:fresh',
    name: 'Fresh start: keep latest 10 + last 7 days',
    builtIn: true,
    rules: { ...base, keepLatest: 10, keepRecentDays: 7 },
  },
];

export function stripPins(rules: RuleSet): PresetRules {
  const { protectedIds: _ignored, ...rest } = rules;
  return { ...rest, protectTitlePatterns: [...rest.protectTitlePatterns] };
}

/** Applies a preset while keeping the user's pinned chats. */
export function applyPreset(current: RuleSet, preset: Preset): RuleSet {
  return { ...DEFAULT_RULES, ...preset.rules, protectedIds: [...current.protectedIds] };
}

export function createPreset(name: string, rules: RuleSet, now: number): Preset {
  const clean = name.trim();
  if (!clean) throw new Error('A preset needs a name.');
  return { id: `user:${now.toString(36)}`, name: clean, rules: stripPins(rules) };
}

function normPatterns(p: readonly string[]): string[] {
  return p.map((s) => s.trim()).filter(Boolean);
}

/** True when the rules match the preset (pins ignored, blank pattern lines ignored). */
export function rulesMatchPreset(rules: RuleSet, preset: Preset): boolean {
  const a = stripPins(rules);
  const b = preset.rules;
  return (
    a.keepLatest === b.keepLatest &&
    a.keepRecentDays === b.keepRecentDays &&
    a.protectProjects === b.protectProjects &&
    a.protectAssistants === b.protectAssistants &&
    a.protectStarred === b.protectStarred &&
    JSON.stringify(normPatterns(a.protectTitlePatterns)) === JSON.stringify(normPatterns(b.protectTitlePatterns))
  );
}

export function findMatchingPreset(rules: RuleSet, presets: readonly Preset[]): Preset | undefined {
  return presets.find((p) => rulesMatchPreset(rules, p));
}
