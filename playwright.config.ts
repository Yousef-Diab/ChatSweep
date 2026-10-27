import { defineConfig } from '@playwright/test';

// E2E: loads the *built* extension (.output/chrome-mv3) into Chromium against a mocked chatgpt.com.
// Run `npm run build` first (the `e2e` script does it for you).
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  workers: 1,
  reporter: [['list']],
});
