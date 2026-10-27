/*
 * ChatSweep probe: READ-ONLY. Paste into DevTools → Console on https://chatgpt.com (logged in).
 *
 * Checks the internal endpoints ChatSweep relies on and produces a REDACTED report:
 * no titles, no message text, no full ids, never the access token. Nothing is modified.
 *
 * chatgpt.com silences console.log, so the report is shown three ways:
 *   1. a box on the page with a "Copy" button,
 *   2. the value of the promise in the console ("PromiseResult"),
 *   3. the clipboard (DevTools copy()).
 */
(async () => {
  const report = { probeVersion: 2, ranAt: new Date().toISOString(), steps: {} };
  const shapeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
  const TIME_KEYS = new Set(['create_time', 'update_time']);
  // Safe value: booleans/numbers/null and timestamps as-is; every other string → its length only.
  const safe = (k, v) => {
    if (v === null || typeof v === 'boolean' || typeof v === 'number') return v;
    if (typeof v === 'string') {
      if (TIME_KEYS.has(k)) return v;
      if (k === 'gizmo_id') return `${v.slice(0, 4)}…`;
      return `<string ${v.length}>`;
    }
    return `<${shapeOf(v)}>`;
  };

  try {
    // 1. Session
    const s = await fetch('/api/auth/session', { credentials: 'include' });
    const session = await s.json().catch(() => null);
    report.steps.session = {
      status: s.status,
      hasAccessToken: !!session?.accessToken,
      topLevelKeys: session ? Object.keys(session) : null,
      hasAccountId: !!session?.account?.id,
    };
    if (!session?.accessToken) throw new Error('No access token: are you logged in on this tab?');

    const headers = { Authorization: `Bearer ${session.accessToken}` };
    if (session.account?.id) headers['ChatGPT-Account-ID'] = session.account.id;
    const get = async (path) => {
      const t0 = performance.now();
      const res = await fetch(path, { headers, credentials: 'include' });
      const body = await res.json().catch(() => null);
      return { status: res.status, ms: Math.round(performance.now() - t0), body };
    };

    // 2. Conversation list — ask for 100
    const r = await get('/backend-api/conversations?offset=0&limit=100&order=updated&is_archived=false');
    const items = Array.isArray(r.body?.items) ? r.body.items : [];
    const keyTypes = {};
    for (const it of items) for (const [k, v] of Object.entries(it)) (keyTypes[k] ??= new Set()).add(shapeOf(v));
    report.steps.list = {
      status: r.status,
      ms: r.ms,
      topLevelKeys: r.body ? Object.keys(r.body) : null,
      total: r.body?.total,
      limitEcho: r.body?.limit,
      requested: 100,
      received: items.length,
      itemKeyTypes: Object.fromEntries(Object.entries(keyTypes).map(([k, v]) => [k, [...v]])),
      gizmoPrefixes: [...new Set(items.map((i) => (typeof i.gizmo_id === 'string' ? i.gizmo_id.slice(0, 4) : String(i.gizmo_id))))],
      projectChatsInMainList: items.filter((i) => typeof i.gizmo_id === 'string' && i.gizmo_id.startsWith('g-p-')).length,
      pinnedLikeFields: Object.keys(keyTypes).filter((k) => /pin|star/i.test(k)),
      pinnedLikeTrueCount: items.filter((i) => Object.entries(i).some(([k, v]) => /pin|star/i.test(k) && v)).length,
      orderedByUpdateDesc: items.every(
        (it, i) => i === 0 || Date.parse(items[i - 1].update_time) >= Date.parse(it.update_time),
      ),
      sample: items.slice(0, 2).map((i) => Object.fromEntries(Object.entries(i).map(([k, v]) => [k, safe(k, v)]))),
    };

    // 3. Second page — does offset paging work?
    if (items.length > 0) {
      const p2 = await get(`/backend-api/conversations?offset=${items.length}&limit=100&order=updated&is_archived=false`);
      const ids1 = new Set(items.map((i) => i.id));
      const p2items = Array.isArray(p2.body?.items) ? p2.body.items : [];
      report.steps.page2 = {
        status: p2.status,
        received: p2items.length,
        overlapWithPage1: p2items.filter((i) => ids1.has(i.id)).length,
      };
    }

    // 4. Archived list (read-only)
    const a = await get('/backend-api/conversations?offset=0&limit=5&order=updated&is_archived=true');
    report.steps.archivedList = { status: a.status, total: a.body?.total, received: a.body?.items?.length };

    // 5. One full conversation (the backup endpoint) — structure only, no text
    if (items[0]?.id) {
      const c = await get(`/backend-api/conversation/${encodeURIComponent(items[0].id)}`);
      const mapping = c.body?.mapping && typeof c.body.mapping === 'object' ? c.body.mapping : {};
      const nodes = Object.values(mapping);
      const count = (f) => nodes.reduce((acc, n) => ((acc[f(n)] = (acc[f(n)] ?? 0) + 1), acc), {});
      report.steps.conversation = {
        status: c.status,
        ms: c.ms,
        topLevelKeys: c.body ? Object.keys(c.body) : null,
        hasCurrentNode: typeof c.body?.current_node === 'string' && !!mapping[c.body.current_node],
        nodeCount: nodes.length,
        roles: count((n) => n.message?.author?.role ?? '(none)'),
        contentTypes: count((n) => n.message?.content?.content_type ?? '(none)'),
        partTypes: count((n) => {
          const parts = n.message?.content?.parts;
          if (!Array.isArray(parts)) return '(no parts)';
          return parts.map((p) => (typeof p === 'string' ? 'string' : (p?.content_type ?? shapeOf(p)))).join('+') || '(empty)';
        }),
        createTimeType: shapeOf(c.body?.create_time),
      };
    }
    report.ok = true;
  } catch (err) {
    report.ok = false;
    report.error = String(err?.message ?? err);
  }

  const text = JSON.stringify(report, null, 2);

  // Show it on the page (works even when console.log is silenced).
  document.getElementById('chatsweep-probe')?.remove();
  const box = document.createElement('div');
  box.id = 'chatsweep-probe';
  box.style.cssText =
    'position:fixed;inset:24px;z-index:2147483647;background:#111;color:#eee;padding:12px;border-radius:10px;' +
    'display:flex;flex-direction:column;gap:8px;font:12px ui-monospace,monospace;box-shadow:0 10px 40px #0008';
  const head = document.createElement('div');
  head.textContent = `ChatSweep probe report (${report.ok ? 'OK' : 'ERROR'}): redacted, safe to share`;
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
    copy(text); // DevTools-only helper
  } catch {}
  return text; // visible as PromiseResult in the console
})();
