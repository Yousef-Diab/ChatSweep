// Renders store screenshots + promo tile into store/ (see e2e/store-assets.spec.ts).
// Cross-platform way to set STORE_ASSETS without adding a dependency.
import { execSync } from 'node:child_process';

execSync('npx wxt build', { stdio: 'inherit' });
execSync('npx playwright test e2e/store-assets.spec.ts', { stdio: 'inherit', env: { ...process.env, STORE_ASSETS: '1' } });
