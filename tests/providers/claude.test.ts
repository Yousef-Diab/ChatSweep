import { describe, expect, it } from 'vitest';
import { asList, ClaudeProvider, mapClaudeItem, pickOrg, readCookie } from '../../src/providers/claude';
import { ProviderError } from '../../src/providers/types';
import liveItem from '../fixtures/claude/chat-conversations-item.live-shape.json';

type Call = { url: string; init?: RequestInit };

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function fakeFetch(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const fn = async (url: string, init?: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    return respond(call);
  };
  return { fn, calls };
}

const ORG = 'org-aaaa';
const orgs = [
  { uuid: 'org-api', name: 'API org', capabilities: ['api'] },
  { uuid: ORG, name: 'Personal', capabilities: ['chat', 'claude_pro'] },
];

function item(i: number, extra: Record<string, unknown> = {}) {
  return {
    uuid: `conv-${i}`,
    name: `Chat ${i}`,
    summary: '',
    created_at: '2026-10-01T10:00:00.000000+00:00',
    updated_at: new Date(Date.UTC(2026, 9, 27) - i * 60_000).toISOString(),
    is_starred: false,
    is_archived: false,
    is_temporary: false,
    project: null,
    ...extra,
  };
}

/** A tiny claude.ai: organizations + paged list honouring limit/offset. */
function claudeApi(total: number, opts: { wrap?: boolean } = {}) {
  const all = Array.from({ length: total }, (_, i) => item(i));
  return fakeFetch(({ url }) => {
    const u = new URL(url);
    if (u.pathname === '/api/organizations') return json(orgs);
    if (u.pathname === `/api/organizations/${ORG}/chat_conversations`) {
      const limit = Number(u.searchParams.get('limit'));
      const offset = Number(u.searchParams.get('offset'));
      const page = all.slice(offset, offset + limit);
      return json(opts.wrap ? { data: page, has_more: offset + limit < all.length } : page);
    }
    throw new Error(`unexpected ${url}`);
  });
}

const noSleep = async () => {};

describe('mapClaudeItem', () => {
  it('maps the fields the rules engine needs', () => {
    expect(
      mapClaudeItem(item(3, { is_starred: true, project: { uuid: 'proj-1', name: 'Proj' }, name: '  ' })),
    ).toEqual({
      id: 'conv-3',
      provider: 'claude',
      title: 'Untitled chat',
      createdAt: '2026-10-01T10:00:00.000Z',
      updatedAt: new Date(Date.UTC(2026, 9, 27) - 3 * 60_000).toISOString(),
      projectId: 'proj-1',
      assistantId: null,
      starred: true,
      archived: false,
    });
  });

  it('matches the live list-item shape (2026-10-27 probe)', () => {
    const { _note, ...raw } = liveItem;
    expect(mapClaudeItem(raw)).toEqual({
      id: raw.uuid,
      provider: 'claude',
      title: raw.name,
      createdAt: '2026-10-26T12:04:35.963Z',
      updatedAt: '2026-10-26T12:15:57.511Z',
      projectId: null,
      assistantId: null,
      starred: false,
      archived: false,
    });
  });

  it('reads the project from `project.uuid`, the older `project_uuid`, or protects an unreadable project', () => {
    expect(mapClaudeItem({ uuid: 'a', project: { uuid: 'p1' } })!.projectId).toBe('p1');
    expect(mapClaudeItem({ uuid: 'a', project_uuid: 'p2' })!.projectId).toBe('p2');
    expect(mapClaudeItem({ uuid: 'a', project: { name: 'no uuid' } })!.projectId).toBe('project');
    expect(mapClaudeItem({ uuid: 'a', project: null })!.projectId).toBeNull();
  });

  it('falls back to created_at and drops items without an id', () => {
    expect(mapClaudeItem({ uuid: 'x', created_at: '2026-01-01T00:00:00Z' })!.updatedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(mapClaudeItem({ name: 'no id' })).toBeNull();
  });
});

describe('org selection', () => {
  it('prefers the last active org when it can chat, else any chat org', () => {
    const two = [...orgs, { uuid: 'org-team', name: 'Team', capabilities: ['chat', 'raven'] }];
    expect(pickOrg(two, 'org-team')!.uuid).toBe('org-team');
    expect(pickOrg(two, 'org-api')!.uuid).toBe(ORG); // API-only orgs have no chats
    expect(pickOrg(two, null)!.uuid).toBe(ORG);
    expect(pickOrg([], null)).toBeNull();
  });

  it('reads cookies and list wrappers', () => {
    expect(readCookie('a=1; lastActiveOrg=org-x; b=2', 'lastActiveOrg')).toBe('org-x');
    expect(readCookie('a=1', 'lastActiveOrg')).toBeNull();
    expect(asList([1])).toEqual([1]);
    expect(asList({ data: [2] })).toEqual([2]);
    expect(asList({ nope: 1 })).toBeNull();
  });
});

describe('ClaudeProvider', () => {
  it('session: picks the chat org and labels the account by org name', async () => {
    const { fn, calls } = claudeApi(0);
    const p = new ClaudeProvider({ fetch: fn, sleep: noSleep, cookie: () => '' });
    expect(await p.getSession()).toEqual({ accountLabel: 'Personal' });
    expect(calls[0]!.url).toBe('https://claude.ai/api/organizations');
    expect(calls[0]!.init?.credentials).toBe('include');
  });

  it('session: logged out → not-logged-in', async () => {
    const { fn } = fakeFetch(() => json({ error: 'nope' }, 403));
    const p = new ClaudeProvider({ fetch: fn, sleep: noSleep, cookie: () => '' });
    await expect(p.getSession()).rejects.toMatchObject({ code: 'not-logged-in' });
  });

  it('lists every page until a short page', async () => {
    const { fn, calls } = claudeApi(230);
    const progress: number[] = [];
    const p = new ClaudeProvider({ fetch: fn, sleep: noSleep, cookie: () => '' });
    const chats = await p.listChats((x) => progress.push(x.loaded));
    expect(chats).toHaveLength(230);
    expect(new Set(chats.map((c) => c.id)).size).toBe(230);
    expect(progress).toEqual([100, 200, 230]);
    const listCalls = calls.filter((c) => c.url.includes('chat_conversations'));
    expect(listCalls.map((c) => new URL(c.url).searchParams.get('offset'))).toEqual(['0', '100', '200']);
  });

  it('accepts a { data, has_more } wrapper', async () => {
    const { fn } = claudeApi(100, { wrap: true });
    const p = new ClaudeProvider({ fetch: fn, sleep: noSleep, cookie: () => '' });
    expect(await p.listChats()).toHaveLength(100); // has_more:false stops without an empty extra page
  });

  it('stops when the server ignores offset (no infinite loop)', async () => {
    const page = Array.from({ length: 100 }, (_, i) => item(i));
    const { fn, calls } = fakeFetch(({ url }) => (url.endsWith('/organizations') ? json(orgs) : json(page)));
    const p = new ClaudeProvider({ fetch: fn, sleep: noSleep, cookie: () => '' });
    expect(await p.listChats()).toHaveLength(100);
    expect(calls.filter((c) => c.url.includes('chat_conversations'))).toHaveLength(2);
  });

  it('skips temporary (incognito) and archived chats', async () => {
    const { fn } = fakeFetch(({ url }) =>
      url.endsWith('/organizations')
        ? json(orgs)
        : json([item(0), item(1, { is_temporary: true }), item(2, { is_archived: true })]),
    );
    const p = new ClaudeProvider({ fetch: fn, sleep: noSleep, cookie: () => '' });
    expect((await p.listChats()).map((c) => c.id)).toEqual(['conv-0']);
  });

  it('a changed list shape is a clear bad-response', async () => {
    const { fn } = fakeFetch(({ url }) => (url.endsWith('/organizations') ? json(orgs) : json({ conversations: [] })));
    const p = new ClaudeProvider({ fetch: fn, sleep: noSleep, cookie: () => '' });
    await expect(p.listChats()).rejects.toMatchObject({ code: 'bad-response' });
  });

  it('delete: one DELETE per chat, on the chosen org, with the cookie session', async () => {
    const { fn, calls } = fakeFetch(({ url }) => (url.endsWith('/organizations') ? json(orgs) : new Response(null, { status: 204 })));
    const p = new ClaudeProvider({ fetch: fn, sleep: noSleep, cookie: () => '' });
    await p.apply('delete', 'conv/1');
    const del = calls.at(-1)!;
    expect(del.init?.method).toBe('DELETE');
    expect(del.url).toBe(`https://claude.ai/api/organizations/${ORG}/chat_conversations/conv%2F1`);
    expect(del.init?.credentials).toBe('include');
    expect(del.init?.body).toBeUndefined();
  });

  it('refuses archive: Claude has none', async () => {
    const { fn, calls } = claudeApi(0);
    const p = new ClaudeProvider({ fetch: fn, sleep: noSleep, cookie: () => '' });
    await expect(p.apply('archive', 'conv-1')).rejects.toBeInstanceOf(ProviderError);
    expect(calls.some((c) => c.init?.method === 'DELETE')).toBe(false);
  });

  it('maps HTTP errors to codes the job runner understands', async () => {
    const cases: Array<[Response, string]> = [
      [json({}, 404), 'not-found'],
      [json({}, 429, { 'retry-after': '3' }), 'rate-limited'],
      [json({}, 503), 'server'],
      [json({}, 401), 'unauthorized'],
    ];
    for (const [res, code] of cases) {
      const { fn } = fakeFetch(({ url }) => (url.endsWith('/organizations') ? json(orgs) : res));
      const p = new ClaudeProvider({ fetch: fn, sleep: noSleep, cookie: () => '' });
      const err = await p.apply('delete', 'c').catch((e: ProviderError) => e);
      expect(err).toMatchObject({ code });
      if (code === 'rate-limited') expect((err as ProviderError).retryAfterMs).toBe(3000);
    }
  });

  it('export: full conversation with the tree; rejects unexpected shapes', async () => {
    const conv = { uuid: 'conv-1', name: 'x', chat_messages: [] };
    const { fn, calls } = fakeFetch(({ url }) => (url.endsWith('/organizations') ? json(orgs) : json(conv)));
    const p = new ClaudeProvider({ fetch: fn, sleep: noSleep, cookie: () => '' });
    expect(await p.exportChat('conv-1')).toEqual(conv);
    expect(calls.at(-1)!.url).toContain('/chat_conversations/conv-1?tree=True&rendering_mode=messages');

    const bad = fakeFetch(({ url }) => (url.endsWith('/organizations') ? json(orgs) : json({ uuid: 'x' })));
    await expect(new ClaudeProvider({ fetch: bad.fn, sleep: noSleep, cookie: () => '' }).exportChat('x')).rejects.toMatchObject({
      code: 'bad-response',
    });
  });
});
