# Contributing to ChatSweep

Thanks for helping. Bug reports, rule ideas and PRs are all welcome.

## Setup

```bash
npm install                          # also runs `wxt prepare`
npx playwright install chromium      # only needed for e2e
npm run dev                          # opens a browser with the extension loaded, hot reload
```

Needs Node 22 or newer. Before opening a PR, run the same checks as CI:

```bash
npm run compile && npm test && npm run e2e && npm run lint:firefox
```

## Ground rules

- **Safety first.** Reversible actions by default, typed confirmation for deletes, protections always win over manual
  choices, and scheduled checks never sweep on their own. PRs that weaken these won't be merged.
- **Minimal permissions.** Any new permission or host needs a clear reason, added to the table in the README.
- **No telemetry, no remote code, no server.** Everything stays in the user's browser.
- **Probe before building.** ChatGPT and Claude have no public API, so adapters use the sites' internal endpoints.
  Confirm response shapes with a read-only, redacted probe (see `spike/`) before relying on them, and never commit
  real chat titles, message text, ids or tokens.
- Keep the core (`src/core/`) free of browser APIs, and cover rule or planner changes with unit tests.

## Adding a provider

See the checklist in [HANDOFF.md](HANDOFF.md) and the existing adapters in `src/providers/`. A new provider needs: an
adapter, a content script, a host permission, a registry entry, a backup Markdown renderer, unit tests with a fake
`fetch`, and an e2e test against a mocked origin.

## When a provider changes its site

If ChatSweep suddenly shows "the site may have changed", run the matching probe in `spike/` on a logged-in tab and
attach its (redacted) report to an issue.
