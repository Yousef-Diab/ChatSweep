/**
 * Claude adapter.
 *
 * Uses the same internal endpoints as the claude.ai web app (unofficial — they can change).
 * Auth is the page's own session cookie; there is no token to handle.
 *   GET    /api/organizations                                              → [{ uuid, name, capabilities[] }]
 *   GET    /api/organizations/{org}/chat_conversations?limit&offset         → [{ uuid, name, created_at, updated_at, is_starred, is_archived, is_temporary, project }]
 *   DELETE /api/organizations/{org}/chat_conversations/{uuid}               delete (permanent)
 *   GET    /api/organizations/{org}/chat_conversations/{uuid}?tree=True&…   full conversation (backup)
 *
 * Claude has no archive, so the only action is Delete. Requests go one at a time (the job
 * runner owns pacing); the bulk `delete_many` endpoint is deliberately not used, so one bad
 * chat can never fail a whole batch.
 *
 * STATUS: read side checked against a live account (spike/results/2026-10-27-claude-probe.json):
 * organizations, list shape and order, and the conversation tree all match. Not yet seen live:
 * paging past 100 chats, a starred chat, a chat in a Project, and a real DELETE.
 */
import type { ChatMeta, ProviderCapabilities, SweepAction } from '../core/types';
import { pageFetch, parseRetryAfter, realSleep, toIso, type FetchLike } from './shared';
import { ProviderError, type ListProgress, type Provider, type SessionInfo } from './types';

export const CLAUDE_ORIGIN = 'https://claude.ai';
const PAGE_SIZE = 100;
const PAGE_DELAY_MS = 350;
const MAX_PAGES = 2_000;

export interface ClaudeRawOrg {
  uuid?: unknown;
  name?: unknown;
  capabilities?: unknown;
}

export interface ClaudeRawItem {
  uuid?: unknown;
  name?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  is_starred?: unknown;
  /** Live shape (2026-10-27): `project` is null or an object; older code used `project_uuid`. */
  project?: unknown;
  project_uuid?: unknown;
  is_archived?: unknown;
  is_temporary?: unknown;
}

function projectIdOf(raw: ClaudeRawItem): string | null {
  const p = raw.project as { uuid?: unknown } | null | undefined;
  if (p && typeof p === 'object' && typeof p.uuid === 'string' && p.uuid) return p.uuid;
  if (typeof raw.project_uuid === 'string' && raw.project_uuid) return raw.project_uuid;
  // A project object we can't read is still a project: protect it rather than sweep it.
  if (p && typeof p === 'object') return 'project';
  return null;
}

/** Bare arrays and `{ data: [...] }` wrappers are both accepted. */
export function asList(body: unknown): unknown[] | null {
  if (Array.isArray(body)) return body;
  const data = (body as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? data : null;
}

/**
 * The org to work in: the one the web app last used (its `lastActiveOrg` cookie) if it can chat,
 * else the first org that can chat, else the first org. API-only orgs have no chats.
 */
export function pickOrg(orgs: readonly ClaudeRawOrg[], lastActiveOrg: string | null): ClaudeRawOrg | null {
  const valid = orgs.filter((o) => typeof o.uuid === 'string' && o.uuid);
  const canChat = (o: ClaudeRawOrg) => Array.isArray(o.capabilities) && o.capabilities.includes('chat');
  return (
    valid.find((o) => o.uuid === lastActiveOrg && canChat(o)) ??
    valid.find(canChat) ??
    valid[0] ??
    null
  );
}

export function readCookie(cookie: string, name: string): string | null {
  for (const part of cookie.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

/** Pure mapping from a raw list item to ChatMeta. Returns null for items without an id. */
export function mapClaudeItem(raw: ClaudeRawItem): ChatMeta | null {
  if (typeof raw.uuid !== 'string' || !raw.uuid) return null;
  const createdAt = toIso(raw.created_at);
  return {
    id: raw.uuid,
    provider: 'claude',
    title: typeof raw.name === 'string' && raw.name.trim() ? raw.name : 'Untitled chat',
    createdAt,
    updatedAt: toIso(raw.updated_at) || createdAt,
    projectId: projectIdOf(raw),
    assistantId: null,
    starred: raw.is_starred === true,
    archived: raw.is_archived === true,
  };
}

export interface ClaudeOptions {
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  origin?: string;
  /** For tests; defaults to document.cookie. */
  cookie?: () => string;
}

export class ClaudeProvider implements Provider {
  readonly id = 'claude' as const;
  readonly displayName = 'Claude';
  readonly capabilities: ProviderCapabilities = { archive: false, star: true, projects: true, assistants: false };

  private orgId: string | null = null;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly origin: string;
  private readonly cookie: () => string;

  constructor(opts: ClaudeOptions = {}) {
    this.fetchImpl = opts.fetch ?? pageFetch();
    this.sleep = opts.sleep ?? realSleep;
    this.origin = opts.origin ?? CLAUDE_ORIGIN;
    this.cookie = opts.cookie ?? (() => (typeof document === 'undefined' ? '' : document.cookie));
  }

  async getSession(): Promise<SessionInfo> {
    let body: unknown;
    try {
      body = await this.request<unknown>('GET', '/organizations', true);
    } catch (err) {
      if (err instanceof ProviderError && err.code === 'unauthorized') {
        throw new ProviderError('not-logged-in', 'Not logged in to Claude.', err.status);
      }
      throw err;
    }
    const orgs = asList(body);
    if (!orgs) throw new ProviderError('bad-response', 'Claude returned an unexpected account list. The site may have changed.');
    const org = pickOrg(orgs as ClaudeRawOrg[], readCookie(this.cookie(), 'lastActiveOrg'));
    if (!org) throw new ProviderError('not-logged-in', 'Not logged in to Claude.');
    this.orgId = org.uuid as string;
    return { accountLabel: typeof org.name === 'string' && org.name.trim() ? org.name : 'Claude account' };
  }

  async listChats(onProgress?: (p: ListProgress) => void): Promise<ChatMeta[]> {
    const seen = new Map<string, ChatMeta>();
    let offset = 0;

    for (let page = 0; page < MAX_PAGES; page++) {
      const body = await this.request<unknown>('GET', `${await this.base()}?limit=${PAGE_SIZE}&offset=${offset}`);
      const items = asList(body);
      if (!items) {
        throw new ProviderError('bad-response', 'Claude returned an unexpected conversation list. The site may have changed.');
      }

      const before = seen.size;
      for (const raw of items as ClaudeRawItem[]) {
        if (raw?.is_temporary === true) continue; // incognito chats aren't in the sidebar; leave them alone
        if (raw?.is_archived === true) continue; // like ChatGPT: chats the user archived are left alone
        const chat = mapClaudeItem(raw ?? {});
        if (chat && !seen.has(chat.id)) seen.set(chat.id, chat);
      }
      offset += items.length;
      onProgress?.({ loaded: seen.size, total: null });

      // Older builds of the API ignore limit/offset and return everything at once: then the
      // second page repeats the first and the no-progress check ends the loop.
      const hasMore = (body as { has_more?: unknown } | null)?.has_more;
      const lastPage = items.length < PAGE_SIZE || hasMore === false;
      const noProgress = items.length > 0 && seen.size === before;
      if (lastPage || noProgress) return [...seen.values()];
      await this.sleep(PAGE_DELAY_MS);
    }
    throw new ProviderError('bad-response', 'Gave up paging the conversation list (too many pages).');
  }

  async apply(action: SweepAction, chatId: string): Promise<void> {
    if (action !== 'delete') throw new ProviderError('unknown', 'Claude has no archive. Use Delete instead.');
    await this.request<unknown>('DELETE', `${await this.base()}/${encodeURIComponent(chatId)}`);
  }

  /** Full conversation (for backups). Returned untouched; see backup/claudeMarkdown.ts for rendering. */
  async exportChat(chatId: string): Promise<unknown> {
    const raw = await this.request<unknown>(
      'GET',
      `${await this.base()}/${encodeURIComponent(chatId)}?tree=True&rendering_mode=messages&render_all_tools=true`,
    );
    if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { chat_messages?: unknown }).chat_messages)) {
      throw new ProviderError('bad-response', 'Claude returned an unexpected conversation. The site may have changed.');
    }
    return raw;
  }

  private async base(): Promise<string> {
    if (!this.orgId) await this.getSession();
    return `/organizations/${encodeURIComponent(this.orgId!)}/chat_conversations`;
  }

  /** One HTTP call; maps failures to ProviderError. The job runner owns retries. */
  private async request<T>(method: 'GET' | 'DELETE', path: string, isSessionCheck = false): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.origin}/api${path}`, {
        method,
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
    } catch (err) {
      throw new ProviderError('network', `Network error: ${(err as Error).message}`);
    }

    if (res.status === 401 || res.status === 403) {
      if (!isSessionCheck) this.orgId = null; // re-pick the org next time (logged out / switched account)
      throw new ProviderError('unauthorized', 'Claude session expired. Reload the Claude tab and log in again.', res.status);
    }
    if (res.status === 404) throw new ProviderError('not-found', 'Chat not found (already removed?).', 404);
    if (res.status === 429) {
      throw new ProviderError('rate-limited', 'Claude is rate-limiting requests.', 429, parseRetryAfter(res.headers.get('retry-after')));
    }
    if (res.status >= 500) throw new ProviderError('server', `Claude server error (${res.status}).`, res.status);
    if (!res.ok) throw new ProviderError('unknown', `Unexpected HTTP ${res.status}.`, res.status);

    if (res.status === 204) return null as T;
    const text = await res.text();
    if (!text) return null as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ProviderError('bad-response', 'Claude returned something that is not JSON.');
    }
  }
}
