import { describe, expect, it } from 'vitest';
import { compileTitlePatterns, validateRules } from '../../src/core/rules';
import { DEFAULT_RULES } from '../../src/core/types';

describe('compileTitlePatterns', () => {
  it('treats plain text as case-insensitive contains', () => {
    const { matchers, errors } = compileTitlePatterns(['Invoice']);
    expect(errors).toEqual([]);
    expect(matchers[0]!.test('march INVOICE draft')).toBe(true);
    expect(matchers[0]!.test('receipt')).toBe(false);
  });

  it('supports /regex/flags', () => {
    const { matchers } = compileTitlePatterns(['/^tax \\d{4}$/i']);
    expect(matchers[0]!.test('TAX 2025')).toBe(true);
    expect(matchers[0]!.test('my tax 2025')).toBe(false);
  });

  it('drops stateful g/y flags so repeated tests are stable', () => {
    const { matchers } = compileTitlePatterns(['/work/gy']);
    const m = matchers[0]!;
    expect([m.test('work'), m.test('work'), m.test('work')]).toEqual([true, true, true]);
  });

  it('ignores blank lines and reports invalid regexes without throwing', () => {
    const { matchers, errors } = compileTitlePatterns(['  ', '', '/([unclosed/', 'ok']);
    expect(matchers.map((m) => m.source)).toEqual(['ok']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('/([unclosed/');
  });

  it('treats a lone slash or "//" as plain text, not regex', () => {
    const { matchers } = compileTitlePatterns(['/', '//']);
    expect(matchers).toHaveLength(2);
    expect(matchers[0]!.test('a/b')).toBe(true);
  });
});

describe('validateRules', () => {
  it('accepts the defaults', () => {
    expect(validateRules(DEFAULT_RULES)).toEqual([]);
  });

  it('rejects negative / fractional counts and bad regexes', () => {
    const problems = validateRules({
      ...DEFAULT_RULES,
      keepLatest: 2.5,
      keepRecentDays: -1,
      protectTitlePatterns: ['/(/'],
    });
    expect(problems).toHaveLength(3);
  });
});
