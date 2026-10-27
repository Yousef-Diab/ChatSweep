/** The Claude probe must work with console.log silenced, stay read-only, and never leak names or text. */
import { chromium, expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const PROBE = readFileSync(path.resolve('spike/claude-probe.js'), 'utf8');
const SECRETS = ['Secret chat name', 'private message body', 'Acme Org Name', 'org-uuid-1234', 'conv-uuid-0'];

test('claude probe: redacted, read-only, visible without console.log', async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const writes: string[] = [];

  await context.route('https://claude.ai/**', (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() !== 'GET') writes.push(`${req.method()} ${url.pathname}`);
    const json = (body: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/organizations') {
      return json([{ uuid: 'org-uuid-1234', name: 'Acme Org Name', capabilities: ['chat', 'claude_pro'] }]);
    }
    const base = '/api/organizations/org-uuid-1234/chat_conversations';
    if (url.pathname === base) {
      if (url.searchParams.get('starred') === 'true') return json([{ uuid: 'conv-uuid-0', name: 'Secret chat name', is_starred: true }]);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const all = Array.from({ length: 130 }, (_, i) => ({
        uuid: `conv-uuid-${i}`,
        name: 'Secret chat name',
        summary: 'private message body',
        created_at: '2026-10-01T00:00:00.000000+00:00',
        updated_at: new Date(Date.UTC(2026, 9, 27) - i * 60_000).toISOString(),
        is_starred: i === 0,
        project_uuid: i === 5 ? 'proj-1' : null,
      }));
      return json(all.slice(offset, offset + 100));
    }
    if (url.pathname === `${base}/conv-uuid-0`) {
      return json({
        uuid: 'conv-uuid-0',
        name: 'Secret chat name',
        current_leaf_message_uuid: 'm2',
        chat_messages: [
          { uuid: 'm1', sender: 'human', parent_message_uuid: '000', content: [{ type: 'text', text: 'private message body' }], attachments: [], files: [] },
          { uuid: 'm2', sender: 'assistant', parent_message_uuid: 'm1', content: [{ type: 'text', text: 'private message body' }, { type: 'tool_use' }], attachments: [], files: [] },
        ],
      });
    }
    return route.fulfill({ contentType: 'text/html', body: '<html><body>Fake Claude</body></html>' });
  });

  const page = await context.newPage();
  await page.addInitScript(() => {
    console.log = () => {};
  });
  await page.goto('https://claude.ai/');
  const text = (await page.evaluate(PROBE)) as string;
  const r = JSON.parse(text);

  expect(r.ok).toBe(true);
  expect(r.steps.organizations).toMatchObject({ status: 200, count: 1, capabilities: [['chat', 'claude_pro']] });
  expect(r.steps.list).toMatchObject({ shape: 'array', received: 100, starredCount: 1, inProjectCount: 1, orderedByUpdateDesc: true });
  expect(r.steps.page2).toMatchObject({ received: 30, overlapWithPage1: 0 });
  expect(r.steps.starredList).toMatchObject({ received: 1, alsoInMainListPage1: 1 });
  expect(r.steps.conversation).toMatchObject({
    messageCount: 2,
    senders: { human: 1, assistant: 1 },
    contentBlockTypes: { text: 2, tool_use: 1 },
    hasLeafPointer: true,
    hasParentPointers: true,
  });

  await expect(page.locator('#chatsweep-probe textarea')).toHaveValue(text);
  for (const s of SECRETS) expect(text).not.toContain(s);
  expect(writes).toEqual([]);
  await browser.close();
});
