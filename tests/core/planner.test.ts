import { describe, expect, it } from 'vitest';
import { plan, summarize } from '../../src/core/planner';
import { DEFAULT_RULES, type RuleSet } from '../../src/core/types';
import { NOW, chat } from '../helpers';

const NONE: RuleSet = {
  keepLatest: 0,
  keepRecentDays: 0,
  protectTitlePatterns: [],
  protectedIds: [],
  protectProjects: false,
  protectAssistants: false,
  protectStarred: false,
};

function verdicts(decisions: ReturnType<typeof plan>) {
  return Object.fromEntries(decisions.map((d) => [d.chat.id, d.verdict]));
}

describe('plan — ordering and keep-latest', () => {
  it('returns chats most-recent first regardless of input order', () => {
    const a = chat({ daysAgo: 10 });
    const b = chat({ daysAgo: 1 });
    const c = chat({ daysAgo: 5 });
    expect(plan([a, b, c], NONE, NOW).map((d) => d.chat.id)).toEqual([b.id, c.id, a.id]);
  });

  it('keeps exactly the N most recent and sweeps the rest', () => {
    const chats = Array.from({ length: 10 }, (_, i) => chat({ daysAgo: i + 1 }));
    const result = plan(chats, { ...NONE, keepLatest: 3 }, NOW);
    expect(result.filter((d) => d.verdict === 'keep').map((d) => d.chat.id)).toEqual(
      chats.slice(0, 3).map((c) => c.id),
    );
    expect(result[0]!.reasons[0]).toMatchObject({ code: 'latest-n', label: 'Within latest 3 (#1)' });
    expect(result[9]!.reasons[0]!.code).toBe('no-rule-matched');
  });

  it('keepLatest larger than the list keeps everything', () => {
    const chats = [chat(), chat()];
    expect(summarize(plan(chats, { ...NONE, keepLatest: 30 }, NOW)).sweep).toBe(0);
  });

  it('keepLatest = 0 disables the rule', () => {
    expect(summarize(plan([chat(), chat()], NONE, NOW)).keep).toBe(0);
  });

  it('counts protected chats toward latest N (N most recent chats survive overall)', () => {
    const newest = chat({ daysAgo: 1, title: 'invoice' });
    const second = chat({ daysAgo: 2 });
    const third = chat({ daysAgo: 3 });
    const result = plan([newest, second, third], { ...NONE, keepLatest: 2, protectTitlePatterns: ['invoice'] }, NOW);
    expect(verdicts(result)).toEqual({ [newest.id]: 'keep', [second.id]: 'keep', [third.id]: 'sweep' });
  });

  it('breaks updatedAt ties deterministically by id', () => {
    const same = new Date('2026-10-01T00:00:00Z').toISOString();
    const x = { ...chat(), id: 'b', updatedAt: same };
    const y = { ...chat(), id: 'a', updatedAt: same };
    expect(plan([x, y], { ...NONE, keepLatest: 1 }, NOW)[0]!.chat.id).toBe('a');
  });
});

describe('plan — keep recent days', () => {
  it('keeps chats active within the window (inclusive boundary)', () => {
    const inside = chat({ daysAgo: 6 });
    const boundary = chat({ daysAgo: 7 });
    const outside = chat({ daysAgo: 8 });
    const result = plan([inside, boundary, outside], { ...NONE, keepRecentDays: 7 }, NOW);
    expect(verdicts(result)).toEqual({ [inside.id]: 'keep', [boundary.id]: 'keep', [outside.id]: 'sweep' });
  });
});

describe('plan — protections', () => {
  it('protects pinned ids, title matches, projects, custom GPTs and starred chats', () => {
    const pinned = chat({ daysAgo: 100 });
    const titled = chat({ daysAgo: 100, title: 'Visa application' });
    const project = chat({ daysAgo: 100, projectId: 'g-p-1' });
    const gpt = chat({ daysAgo: 100, assistantId: 'g-abc' });
    const starred = chat({ daysAgo: 100, starred: true });
    const plain = chat({ daysAgo: 100 });
    const rules: RuleSet = {
      ...NONE,
      protectedIds: [pinned.id],
      protectTitlePatterns: ['visa'],
      protectProjects: true,
      protectAssistants: true,
      protectStarred: true,
    };
    const result = plan([pinned, titled, project, gpt, starred, plain], rules, NOW);
    const byId = Object.fromEntries(result.map((d) => [d.chat.id, d]));
    expect(byId[pinned.id]!.reasons[0]!.code).toBe('protected-id');
    expect(byId[titled.id]!.reasons[0]!.code).toBe('protected-title');
    expect(byId[project.id]!.reasons[0]!.code).toBe('protected-project');
    expect(byId[gpt.id]!.reasons[0]!.code).toBe('protected-assistant');
    expect(byId[starred.id]!.reasons[0]!.code).toBe('protected-starred');
    expect(byId[plain.id]!.verdict).toBe('sweep');
  });

  it('does not protect projects / GPTs / starred when the toggles are off', () => {
    const c = chat({ projectId: 'p', assistantId: 'g', starred: true });
    expect(plan([c], NONE, NOW)[0]!.verdict).toBe('sweep');
  });

  it('keeps chats whose date cannot be parsed, to be safe', () => {
    const broken = { ...chat(), updatedAt: 'not a date' };
    const result = plan([broken], NONE, NOW);
    expect(result[0]).toMatchObject({ verdict: 'keep', reasons: [{ code: 'unknown-date' }] });
  });

  it('lists every applicable reason, protections before soft rules', () => {
    const c = chat({ daysAgo: 1, title: 'tax', starred: true });
    const result = plan([c], { ...DEFAULT_RULES, protectTitlePatterns: ['tax'], keepRecentDays: 7 }, NOW);
    expect(result[0]!.reasons.map((r) => r.code)).toEqual([
      'protected-title',
      'protected-starred',
      'latest-n',
      'recent-days',
    ]);
  });

  it('ignores invalid regex patterns instead of failing the whole plan', () => {
    const c = chat({ title: '(' });
    expect(plan([c], { ...NONE, protectTitlePatterns: ['/(/'] }, NOW)[0]!.verdict).toBe('sweep');
  });
});

describe('plan — manual overrides', () => {
  it('manual keep beats everything', () => {
    const c = chat({ daysAgo: 400 });
    const result = plan([c], NONE, NOW, { [c.id]: 'keep' });
    expect(result[0]).toMatchObject({ verdict: 'keep', reasons: [{ code: 'manual-keep' }] });
  });

  it('manual sweep beats soft keep rules', () => {
    const c = chat({ daysAgo: 1 });
    const result = plan([c], { ...NONE, keepLatest: 30 }, NOW, { [c.id]: 'sweep' });
    expect(result[0]).toMatchObject({ verdict: 'sweep', reasons: [{ code: 'manual-sweep' }] });
    expect(result[0]!.reasons[0]!.label).toContain('overrides');
  });

  it('manual sweep can NOT beat a protection', () => {
    const c = chat({ title: 'passport' });
    const result = plan([c], { ...NONE, protectTitlePatterns: ['passport'] }, NOW, { [c.id]: 'sweep' });
    expect(result[0]!.verdict).toBe('keep');
  });

  it('ignores overrides for ids that are not in the list', () => {
    const c = chat({ daysAgo: 400 });
    expect(plan([c], NONE, NOW, { ghost: 'keep' })[0]!.verdict).toBe('sweep');
  });
});

describe('summarize', () => {
  it('counts verdicts and primary reasons', () => {
    const chats = [chat({ daysAgo: 1 }), chat({ daysAgo: 2, title: 'tax' }), chat({ daysAgo: 300 })];
    const s = summarize(plan(chats, { ...NONE, keepLatest: 1, protectTitlePatterns: ['tax'] }, NOW));
    expect(s).toEqual({
      total: 3,
      keep: 2,
      sweep: 1,
      byReason: { 'latest-n': 1, 'protected-title': 1, 'no-rule-matched': 1 },
    });
  });

  it('handles an empty list', () => {
    expect(summarize([])).toEqual({ total: 0, keep: 0, sweep: 0, byReason: {} });
  });
});

describe('plan — purity', () => {
  it('does not mutate its inputs', () => {
    const chats = [chat({ daysAgo: 5 }), chat({ daysAgo: 1 })];
    const snapshot = JSON.stringify(chats);
    plan(chats, DEFAULT_RULES, NOW);
    expect(JSON.stringify(chats)).toBe(snapshot);
  });
});
