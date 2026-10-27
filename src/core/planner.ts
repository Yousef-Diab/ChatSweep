import { compileTitlePatterns } from './rules';
import type { ChatMeta, Decision, Overrides, Reason, ReasonCode, RuleSet } from './types';

const DAY_MS = 86_400_000;

/**
 * Decide, for every chat, whether it is kept or swept, and why.
 *
 * Precedence (strongest first):
 *  1. Manual "keep" in the preview always wins.
 *  2. Protections (pinned id, title pattern, project, custom GPT, starred, unknown date)
 *     always keep. A manual "sweep" can NOT override a protection: unpin it instead.
 *  3. Manual "sweep" overrides the soft keep rules below.
 *  4. Soft keep rules: within latest N, updated within the last X days.
 *  5. Anything left is swept.
 *
 * "Latest N" counts across ALL chats (protected ones included), ordered by last activity:
 * it means "the N most recent chats survive", which is what users expect from "keep my last 30".
 *
 * Pure: no I/O, deterministic for a given `now`.
 */
export function plan(
  chats: readonly ChatMeta[],
  rules: RuleSet,
  now: Date,
  overrides: Overrides = {},
): Decision[] {
  const { matchers } = compileTitlePatterns(rules.protectTitlePatterns);
  const protectedIds = new Set(rules.protectedIds);
  const recentCutoff = rules.keepRecentDays > 0 ? now.getTime() - rules.keepRecentDays * DAY_MS : null;

  const ordered = [...chats].sort(byMostRecent);

  return ordered.map((chat, index): Decision => {
    const updated = Date.parse(chat.updatedAt);
    const protections: Reason[] = [];
    const softKeeps: Reason[] = [];

    if (protectedIds.has(chat.id)) {
      protections.push(reason('protected-id', 'Pinned in ChatSweep'));
    }
    const titleHit = matchers.find((m) => m.test(chat.title));
    if (titleHit) {
      protections.push(reason('protected-title', `Title matches "${titleHit.source}"`));
    }
    if (rules.protectProjects && chat.projectId) {
      protections.push(reason('protected-project', 'Inside a project'));
    }
    if (rules.protectAssistants && chat.assistantId) {
      protections.push(reason('protected-assistant', 'Chat with a custom GPT'));
    }
    if (rules.protectStarred && chat.starred) {
      protections.push(reason('protected-starred', 'Starred / pinned in the app'));
    }
    if (Number.isNaN(updated)) {
      protections.push(reason('unknown-date', 'Last-activity date unknown (kept to be safe)'));
    }

    if (rules.keepLatest > 0 && index < rules.keepLatest) {
      softKeeps.push(reason('latest-n', `Within latest ${rules.keepLatest} (#${index + 1})`));
    }
    if (recentCutoff !== null && !Number.isNaN(updated) && updated >= recentCutoff) {
      softKeeps.push(reason('recent-days', `Active in the last ${rules.keepRecentDays} days`));
    }

    const manual = overrides[chat.id];

    if (manual === 'keep') {
      return keep(chat, [reason('manual-keep', 'Kept manually'), ...protections, ...softKeeps]);
    }
    if (protections.length > 0) {
      return keep(chat, [...protections, ...softKeeps]);
    }
    if (manual === 'sweep') {
      return {
        chat,
        verdict: 'sweep',
        reasons: [reason('manual-sweep', softKeeps.length ? 'Swept manually (overrides keep rules)' : 'Swept manually')],
      };
    }
    if (softKeeps.length > 0) {
      return keep(chat, softKeeps);
    }
    return { chat, verdict: 'sweep', reasons: [reason('no-rule-matched', 'Not covered by any keep rule')] };
  });
}

export interface PlanSummary {
  total: number;
  keep: number;
  sweep: number;
  /** Counted by each decision's primary (first) reason. */
  byReason: Partial<Record<ReasonCode, number>>;
}

export function summarize(decisions: readonly Decision[]): PlanSummary {
  const summary: PlanSummary = { total: decisions.length, keep: 0, sweep: 0, byReason: {} };
  for (const d of decisions) {
    summary[d.verdict] += 1;
    const primary = d.reasons[0]!.code;
    summary.byReason[primary] = (summary.byReason[primary] ?? 0) + 1;
  }
  return summary;
}

/** Most recent first; unparseable dates sort last; ties broken by id for determinism. */
export function byMostRecent(a: ChatMeta, b: ChatMeta): number {
  const ta = Date.parse(a.updatedAt);
  const tb = Date.parse(b.updatedAt);
  const va = Number.isNaN(ta) ? -Infinity : ta;
  const vb = Number.isNaN(tb) ? -Infinity : tb;
  if (va !== vb) return vb - va;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function reason(code: ReasonCode, label: string): Reason {
  return { code, label };
}

function keep(chat: ChatMeta, reasons: Reason[]): Decision {
  return { chat, verdict: 'keep', reasons };
}
