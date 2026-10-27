import type { ChatMeta, ProviderCapabilities, ProviderId, SweepAction } from '../core/types';

export type ProviderErrorCode =
  | 'not-logged-in' // no session at all
  | 'unauthorized' // session expired mid-run (401/403)
  | 'rate-limited' // 429
  | 'server' // 5xx
  | 'not-found' // chat already gone
  | 'network' // fetch threw
  | 'bad-response' // response shape changed — provider probably updated their app
  | 'no-tab' // no provider tab to run requests in
  | 'unknown';

/** Plain-object error so it survives extension messaging intact. */
export interface ProviderErrorInfo {
  code: ProviderErrorCode;
  message: string;
  status?: number;
  retryAfterMs?: number | null;
}

export class ProviderError extends Error implements ProviderErrorInfo {
  constructor(
    public code: ProviderErrorCode,
    message: string,
    public status?: number,
    public retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = 'ProviderError';
  }

  toInfo(): ProviderErrorInfo {
    return { code: this.code, message: this.message, status: this.status, retryAfterMs: this.retryAfterMs };
  }
}

export function toErrorInfo(err: unknown): ProviderErrorInfo {
  if (err instanceof ProviderError) return err.toInfo();
  if (err && typeof err === 'object' && 'code' in err && 'message' in err) return err as ProviderErrorInfo;
  return { code: 'unknown', message: err instanceof Error ? err.message : String(err) };
}

export interface ListProgress {
  loaded: number;
  total: number | null;
}

export interface SessionInfo {
  /** Display label for the logged-in account/workspace, never a secret. */
  accountLabel: string;
}

/**
 * A provider adapter runs inside a content script on the provider's own origin,
 * so every request is same-origin and uses the user's existing session.
 */
export interface Provider {
  id: ProviderId;
  displayName: string;
  capabilities: ProviderCapabilities;
  getSession(): Promise<SessionInfo>;
  listChats(onProgress?: (p: ListProgress) => void): Promise<ChatMeta[]>;
  apply(action: SweepAction, chatId: string): Promise<void>;
  /** Full raw conversation, for backups. */
  exportChat(chatId: string): Promise<unknown>;
}
