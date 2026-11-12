import { defineConfig } from '@playwright/test';
import { register } from 'tsx/esm/api';

// The test server imports @sendspin/sendspin-js, whose published modules import each other without file
// extensions. Node's own loader rejects that; tsx resolves it, as for the unit tests. Register it here for
// the runner, which loads the specs, and through NODE_OPTIONS for its workers.
register();
if (!/--import[= ]tsx\b/.test(process.env.NODE_OPTIONS ?? '')) process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} --import tsx`.trim();

export default defineConfig({
  testDir: './tests/browser', workers: 1, timeout: 30_000,
  use: { headless: true, trace: 'retain-on-failure' },
});
