/**
 * The DevTools probe must produce a visible report even when the site silences console.log
 * (chatgpt.com does), and must never leak titles, message text or the token.
 */
import { chromium, expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const PROBE = readFileSync(path.resolve('spike/chatgpt-probe.js'), 'utf8');
const SECRET_TITLE = 'My secret medical question';
const SECRET_TEXT = 'private message body';

test('probe reports via on-page box + return value, redacted', async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const patches: string[] = [];

  await context.route('https://chatgpt.com/**', (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (req.method() !== 'GET') patches.push(req.method());
    const json = (body: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/auth/session') return json({ accessToken: 'tok-SECRET', account: { id: 'acct' } });
    if (url.pathname === '/backend-api/conversations') {
      const archived = url.searchParams.get('is_archived') === 'true';
      const offset = Number(url.searchParams.get('offset'));
      if (archived) return json({ items: [], total: 0 });
      const items =
        offset === 0
          ? Array.from({ length: 28 }, (_, i) => ({
              id: `conv-${i}-abcdef`,
              title: SECRET_TITLE,
              create_time: '2026-10-01T00:00:00Z',
              update_time: new Date(Date.UTC(2026, 9, 27) - i * 1000).toISOString(),
              gizmo_id: i === 3 ? 'g-p-proj' : null,
              is_archived: false,
              snippet: SECRET_TEXT,
            }))
          : [];
      return json({ items, total: 28, limit: 28, offset });
    }
    if (url.pathname.startsWith('/backend-api/conversation/')) {
      return json({
        title: SECRET_TITLE,
        create_time: 1761000000.5,
        current_node: 'b',
        mapping: {
          a: { id: 'a', parent: null, children: ['b'], message: { author: { role: 'user' }, content: { content_type: 'text', parts: [SECRET_TEXT] } } },
          b: { id: 'b', parent: 'a', children: [], message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: [SECRET_TEXT] } } },
        },
      });
    }
    return route.fulfill({ contentType: 'text/html', body: '<html><body>Fake</body></html>' });
  });

  const page = await context.newPage();
  await page.addInitScript(() => {
    console.log = () => {}; // what chatgpt.com effectively does
  });
  await page.goto('https://chatgpt.com/');

  const text = (await page.evaluate(PROBE)) as string;
  const report = JSON.parse(text);

  expect(report.ok).toBe(true);
  expect(report.steps.list).toMatchObject({ requested: 100, received: 28, limitEcho: 28, projectChatsInMainList: 1 });
  expect(report.steps.page2).toMatchObject({ received: 0, overlapWithPage1: 0 });
  expect(report.steps.conversation).toMatchObject({ status: 200, hasCurrentNode: true, nodeCount: 2 });

  // Visible on the page even with console.log silenced.
  await expect(page.locator('#chatsweep-probe textarea')).toHaveValue(text);

  // Redaction + read-only.
  for (const secret of [SECRET_TITLE, SECRET_TEXT, 'tok-SECRET', 'conv-0-abcdef']) expect(text).not.toContain(secret);
  expect(patches).toEqual([]);

  await browser.close();
});
