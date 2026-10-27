/**
 * Provider-agnostic types shared by the rules engine, adapters, job runner and UI.
 * Everything here must stay JSON-serialisable (it crosses extension messaging and storage).
 */

export type ProviderId = 'chatgpt' | 'claude';

export interface ChatMeta {
  id: string;
  provider: ProviderId;
  title: string;
  /** ISO-8601 */
  createdAt: string;
  /** ISO-8601 — "last activity", used for ordering */
  updatedAt: string;
  /** Project / folder the chat lives in, if any */
  projectId?: string | null;
  /** Custom GPT / assistant the chat was held with, if any */
  assistantId?: string | null;
  starred?: boolean;
  archived?: boolean;
}

export type SweepAction = 'archive' | 'delete';

export interface ProviderCapabilities {
  archive: boolean;
  star: boolean;
  projects: boolean;
  assistants: boolean;
}

export interface RuleSet {
  /** Keep the N most recently updated chats. 0 disables the rule. */
  keepLatest: number;
  /** Keep chats updated within the last N days. 0 disables the rule. */
  keepRecentDays: number;
  /**
   * Title protections. Plain text = case-insensitive "contains".
   * `/pattern/flags` = regular expression.
   */
  protectTitlePatterns: string[];
  /** Chats the user explicitly pinned inside ChatSweep. */
  protectedIds: string[];
  protectProjects: boolean;
  protectAssistants: boolean;
  protectStarred: boolean;
}

export const DEFAULT_RULES: RuleSet = {
  keepLatest: 30,
  keepRecentDays: 0,
  protectTitlePatterns: [],
  protectedIds: [],
  protectProjects: true,
  protectAssistants: false,
  protectStarred: true,
};

export type ReasonCode =
  | 'manual-keep'
  | 'manual-sweep'
  | 'protected-id'
  | 'protected-title'
  | 'protected-project'
  | 'protected-assistant'
  | 'protected-starred'
  | 'unknown-date'
  | 'latest-n'
  | 'recent-days'
  | 'no-rule-matched';

export interface Reason {
  code: ReasonCode;
  /** Human-readable explanation shown in the preview table. */
  label: string;
}

export type Verdict = 'keep' | 'sweep';

export interface Decision {
  chat: ChatMeta;
  verdict: Verdict;
  /** All rules that applied, strongest first. Never empty. */
  reasons: Reason[];
}

/** Per-chat manual choice made in the preview table. */
export type Overrides = Record<string, Verdict>;
