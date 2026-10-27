import { describe, expect, it } from 'vitest';
import {
  applyPreset,
  BUILT_IN_PRESETS,
  createPreset,
  findMatchingPreset,
  rulesMatchPreset,
} from '../../src/core/presets';
import { validateRules } from '../../src/core/rules';
import { DEFAULT_RULES } from '../../src/core/types';

describe('presets', () => {
  it('built-ins are valid rule sets with unique ids', () => {
    for (const p of BUILT_IN_PRESETS) expect(validateRules(applyPreset(DEFAULT_RULES, p))).toEqual([]);
    expect(new Set(BUILT_IN_PRESETS.map((p) => p.id)).size).toBe(BUILT_IN_PRESETS.length);
  });

  it('applying a preset keeps the user’s pinned chats', () => {
    const current = { ...DEFAULT_RULES, keepLatest: 3, protectedIds: ['a', 'b'] };
    const next = applyPreset(current, BUILT_IN_PRESETS[0]!);
    expect(next.protectedIds).toEqual(['a', 'b']);
    expect(next.keepLatest).toBe(50);
  });

  it('saving a preset strips pins and copies patterns', () => {
    const rules = { ...DEFAULT_RULES, protectTitlePatterns: ['tax'], protectedIds: ['x'] };
    const p = createPreset('  Mine ', rules, 1234);
    expect(p).toMatchObject({ name: 'Mine', id: 'user:ya' });
    expect('protectedIds' in p.rules).toBe(false);
    rules.protectTitlePatterns.push('later');
    expect(p.rules.protectTitlePatterns).toEqual(['tax']);
  });

  it('rejects an empty name', () => {
    expect(() => createPreset('   ', DEFAULT_RULES, 1)).toThrow();
  });

  it('matches ignoring pins and blank pattern lines', () => {
    const p = createPreset('x', { ...DEFAULT_RULES, protectTitlePatterns: ['tax'] }, 1);
    expect(rulesMatchPreset({ ...DEFAULT_RULES, protectTitlePatterns: ['tax', '  '], protectedIds: ['z'] }, p)).toBe(true);
    expect(rulesMatchPreset({ ...DEFAULT_RULES, protectTitlePatterns: ['tax'], keepLatest: 31 }, p)).toBe(false);
  });

  it('defaults match the Balanced preset', () => {
    expect(findMatchingPreset(DEFAULT_RULES, BUILT_IN_PRESETS)?.id).toBe('builtin:balanced');
  });
});
