import { defineConfig } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import './tests/browser/register-sendspin.mjs';

// The test server imports @sendspin/sendspin-js, whose published modules import each other without file
// extensions; register-sendspin.mjs lets Node resolve just those. It is imported above for the runner,
// which loads the specs, and passed through NODE_OPTIONS to the workers that run them.
const hook = `--import=${pathToFileURL('./tests/browser/register-sendspin.mjs').href}`;
if (!(process.env.NODE_OPTIONS ?? '').includes(hook)) process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} ${hook}`.trim();

export default defineConfig({
  testDir: './tests/browser', workers: 1, timeout: 30_000,
  use: { headless: true, trace: 'retain-on-failure' },
});
