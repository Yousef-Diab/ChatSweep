import type { RuleSet } from './types';

export interface TitleMatcher {
  /** The pattern exactly as the user typed it. */
  source: string;
  test(title: string): boolean;
}

export interface CompiledTitlePatterns {
  matchers: TitleMatcher[];
  /** One message per pattern that could not be compiled (those patterns are skipped). */
  errors: string[];
}

const REGEX_LITERAL = /^\/(.+)\/([a-z]*)$/s;

/**
 * Compile the user's title patterns.
 *  - `invoice`         → case-insensitive "title contains invoice"
 *  - `/^tax \d{4}/i`   → regular expression
 * Stateful flags (g, y) are dropped, so `test()` gives the same answer every time.
 */
export function compileTitlePatterns(patterns: readonly string[]): CompiledTitlePatterns {
  const matchers: TitleMatcher[] = [];
  const errors: string[] = [];

  for (const raw of patterns) {
    const source = raw.trim();
    if (!source) continue;

    const literal = REGEX_LITERAL.exec(source);
    if (literal) {
      const body = literal[1]!;
      const flags = literal[2]!.replace(/[gy]/g, '');
      try {
        const re = new RegExp(body, flags);
        matchers.push({ source, test: (title) => re.test(title) });
      } catch (err) {
        errors.push(`Invalid pattern ${source}: ${(err as Error).message}`);
      }
      continue;
    }

    const needle = source.toLocaleLowerCase();
    matchers.push({ source, test: (title) => title.toLocaleLowerCase().includes(needle) });
  }

  return { matchers, errors };
}

/** Returns human-readable problems; an empty array means the rule set is usable. */
export function validateRules(rules: RuleSet): string[] {
  const problems: string[] = [];
  if (!Number.isInteger(rules.keepLatest) || rules.keepLatest < 0) {
    problems.push('"Keep latest" must be a whole number of 0 or more.');
  }
  if (!Number.isFinite(rules.keepRecentDays) || rules.keepRecentDays < 0) {
    problems.push('"Keep recent days" must be 0 or more.');
  }
  problems.push(...compileTitlePatterns(rules.protectTitlePatterns).errors);
  return problems;
}
