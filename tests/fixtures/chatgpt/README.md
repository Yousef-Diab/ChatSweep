# ChatGPT fixtures

`conversations-page.synthetic.json` is **synthetic**. Its shape is modelled on the
`/backend-api/conversations` response as used by public open-source tools (fields `items`,
`total`, `limit`, `offset`, and per-item `id`, `title`, `create_time`, `update_time`,
`gizmo_id`, `is_archived`). It has **not** yet been captured from a live account.

To replace it with a real (redacted) capture, run `spike/chatgpt-probe.js` in DevTools on
chatgpt.com. It prints a redacted page with titles and ids replaced. Save the output here as
`conversations-page.captured.json` and point the adapter tests at it.
