/*
 * ChatSweep Claude probe: READ-ONLY. Paste into DevTools → Console on https://claude.ai (logged in).
 * If Chrome refuses to paste, type `allow pasting` first.
 *
 * Checks the internal endpoints a Claude adapter would rely on and shows a REDACTED report:
 * no chat names, no message text, no org names, no full ids. Nothing is modified.
 * The report appears in a box on the page (Copy button), as the console PromiseResult,
 * and on the clipboard.
 */
(async () => {
  const report = { probe: 'claude', probeVersion: 1, ranAt: new Date().toISOString(), steps: {} };
  const shapeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
  const TIME_KEYS = /(_at|_time)$/;
  const safe = (k, v) => {
    if (v === null || typeof v === 'boolean' || typeof v === 'number') return v;
    if (typeof v === 'string') return TIME_KEYS.test(k) ? v : `<string ${v.length}>`;
    return `<${shapeOf(v)}>`;
  };
  const keyTypes = (rows) => {
    const out = {};
    for (const r of rows) for (const [k, v] of Object.entries(r ?? {})) (out[k] ??= new Set()).add(shapeOf(v));
    return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v]]));
  };
  const get = async (path) => {
    const t0 = performance.now();
    const res = await fetch(`/api${path}`, { credentials: 'include' });
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = text ? `<non-json ${text.length} chars>` : null;
    }
    return { status: res.status, ms: Math.round(performance.now() - t0), body };
  };
  const asList = (body) => (Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : null);

  try {
    // 1. Organizations
    const o = await get('/organizations');
    const orgs = asList(o.body) ?? [];
    report.steps.organizations = {
      status: o.status,
      shape: shapeOf(o.body),
      count: orgs.length,
      keyTypes: keyTypes(orgs),
      capabilities: orgs.map((x) => (Array.isArray(x.capabilities) ? x.capabilities : shapeOf(x.capabilities))),
    };
    if (!orgs.length) throw new Error('No organizations returned: are you logged in on this tab?');

    // Prefer an org that can chat (personal orgs have the "chat" capability).
    const org = orgs.find((x) => Array.isArray(x.capabilities) && x.capabilities.includes('chat')) ?? orgs[0];
    const base = `/organizations/${org.uuid}/chat_conversations`;

    // 2. List — ask for 100
    const l = await get(`${base}?limit=100&offset=0`);
    const items = asList(l.body) ?? [];
    report.steps.list = {
      status: l.status,
      ms: l.ms,
      shape: shapeOf(l.body),
      wrapperKeys: l.body && !Array.isArray(l.body) && typeof l.body === 'object' ? Object.keys(l.body) : null,
      requested: 100,
      received: items.length,
      keyTypes: keyTypes(items),
      starredCount: items.filter((i) => i.is_starred === true).length,
      inProjectCount: items.filter((i) => typeof i.project_uuid === 'string' && i.project_uuid).length,
      archiveLikeFields: Object.keys(keyTypes(items)).filter((k) => /archiv|hidden|visible|temporary/i.test(k)),
      orderedByUpdateDesc: items.every(
        (it, i) => i === 0 || Date.parse(items[i - 1].updated_at) >= Date.parse(it.updated_at),
      ),
      sample: items.slice(0, 2).map((i) => Object.fromEntries(Object.entries(i).map(([k, v]) => [k, safe(k, v)]))),
    };

    // 3. Page 2 — does offset paging work?
    if (items.length > 0) {
      const p2 = await get(`${base}?limit=100&offset=${items.length}`);
      const p2items = asList(p2.body) ?? [];
      const ids1 = new Set(items.map((i) => i.uuid));
      report.steps.page2 = {
        status: p2.status,
        received: p2items.length,
        overlapWithPage1: p2items.filter((i) => ids1.has(i.uuid)).length,
      };
    }

    // 4. Starred filter (the sidebar uses it; tells us whether starred chats come back in the main list too)
    const st = await get(`${base}?starred=true&limit=50`);
    const starred = asList(st.body) ?? [];
    const mainIds = new Set(items.map((i) => i.uuid));
    report.steps.starredList = {
      status: st.status,
      received: starred.length,
      alsoInMainListPage1: starred.filter((i) => mainIds.has(i.uuid)).length,
    };

    // 5. One full conversation (for backups) — structure only
    if (items[0]?.uuid) {
      const c = await get(`${base}/${items[0].uuid}?tree=True&rendering_mode=messages&render_all_tools=true`);
      const msgs = Array.isArray(c.body?.chat_messages) ? c.body.chat_messages : [];
      const count = (arr, f) => arr.reduce((acc, x) => ((acc[f(x)] = (acc[f(x)] ?? 0) + 1), acc), {});
      const blocks = msgs.flatMap((m) => (Array.isArray(m.content) ? m.content : []));
      report.steps.conversation = {
        status: c.status,
        ms: c.ms,
        topLevelKeys: c.body && typeof c.body === 'object' ? Object.keys(c.body) : null,
        messageCount: msgs.length,
        messageKeyTypes: keyTypes(msgs),
        senders: count(msgs, (m) => m.sender ?? '(none)'),
        contentBlockTypes: count(blocks, (b) => b?.type ?? shapeOf(b)),
        hasLeafPointer: typeof c.body?.current_leaf_message_uuid === 'string',
        hasParentPointers: msgs.some((m) => typeof m.parent_message_uuid === 'string'),
        attachmentsCount: msgs.reduce((n, m) => n + (Array.isArray(m.attachments) ? m.attachments.length : 0), 0),
        filesCount: msgs.reduce((n, m) => n + (Array.isArray(m.files) ? m.files.length : 0), 0),
      };
    }
    report.ok = true;
  } catch (err) {
    report.ok = false;
    report.error = String(err?.message ?? err);
  }

  const text = JSON.stringify(report, null, 2);

  document.getElementById('chatsweep-probe')?.remove();
  const box = document.createElement('div');
  box.id = 'chatsweep-probe';
  box.style.cssText =
    'position:fixed;inset:24px;z-index:2147483647;background:#111;color:#eee;padding:12px;border-radius:10px;' +
    'display:flex;flex-direction:column;gap:8px;font:12px ui-monospace,monospace;box-shadow:0 10px 40px #0008';
  const head = document.createElement('div');
  head.textContent = `ChatSweep Claude probe (${report.ok ? 'OK' : 'ERROR'}): redacted, safe to share`;
  const area = document.createElement('textarea');
  area.value = text;
  area.readOnly = true;
  area.style.cssText = 'flex:1;background:#000;color:#9f9;border:1px solid #444;padding:8px;font:inherit';
  const bar = document.createElement('div');
  const btn = (label, fn) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'margin-right:8px;padding:4px 10px;border-radius:6px;border:0;cursor:pointer';
    b.onclick = fn;
    bar.appendChild(b);
    return b;
  };
  const copyBtn = btn('Copy', async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      area.select();
      document.execCommand('copy');
    }
    copyBtn.textContent = 'Copied ✓';
  });
  btn('Close', () => box.remove());
  box.append(head, area, bar);
  document.body.appendChild(box);

  try {
    copy(text);
  } catch {}
  return text;
})();
