import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { productName, productDescription, productTagline } from '../src/product.js';
import { errorPage } from '../src/error-page.js';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('documentation and distribution metadata describe the same music-sharing product', () => {
  assert.equal(productName, 'Doom Room');
  assert.equal(JSON.parse(read('package.json')).name, 'doom-room');
  assert.equal(JSON.parse(read('package.json')).description, productDescription);
  assert.ok(read('config.yaml').startsWith(`name: ${productName}\n`));
  assert.ok(read('config.yaml').includes(`\ndescription: ${productDescription}\n`));
  assert.ok(read('config.yaml').includes(`\npanel_title: ${productName}\n`));
  assert.ok(read('repository.yaml').startsWith(`name: ${productName}\n`));
  assert.ok(read('Dockerfile').includes(`org.opencontainers.image.title="${productName}"`));
  assert.ok(read('Dockerfile').includes(`org.opencontainers.image.description="${productDescription}"`));
  assert.ok(read('web/index.html').includes(`<title>${productName}</title>`));
  assert.ok(read('web/index.html').includes(`content="${productDescription}"`));
  assert.ok(read('README.md').startsWith(`# ${productName}\n`));
  assert.ok(read('README.md').includes(productDescription));
  assert.ok(read('README.md').includes(productTagline));
  assert.ok(read('.github/ISSUE_TEMPLATE/bug-report.yml').includes(`label: ${productName} version`));
});

test('installation, browser and draft identities use the Doom Room names', () => {
  assert.match(read('config.yaml'), /^slug: doom_room$/m);
  assert.match(read('config.yaml'), /^image: ghcr\.io\/magnusoverli\/doom-room$/m);
  assert.match(read('config.yaml'), /^url: https:\/\/github\.com\/magnusoverli\/doom-room$/m);
  assert.ok(read('Dockerfile').includes('org.opencontainers.image.source="https://github.com/magnusoverli/doom-room"'));
  assert.ok(read('src/http.ts').includes("cookie(req, 'doom_room_participant')"));
  assert.ok(read('src/preparation-http.ts').includes("const cookieName = 'doom_room_preparation'"));
  assert.ok(read('src/ma-authorization.ts').includes("const cookieName = 'doom_room_ma_login'"));
  assert.ok(read('src/browser-speakers.ts').includes("export const speakerCookie = 'doom_room_browser_speaker'"));
  assert.ok(read('src/public-listener.ts').includes("const cookieName = '__Host-doom_room_online'"));
  assert.ok(read('web/preparation-controller.ts').includes('doom-room.preparation-pending.v1.'));
  assert.ok(read('web/upload-panel.ts').includes('doom-room.upload-draft.v1.'));
  assert.ok(read('web/record-labels.ts').includes('doom-room.public-record-labels.v1'));
  assert.ok(read('web/browser-speaker.ts').includes('doom-room.sendspin:'));
  assert.ok(read('src/tailscale.ts').includes("'--hostname=doom-room'"));
  assert.ok(read('src/preparation-identity.ts').includes('doom-room-selections:'));
  assert.ok(read('src/preparation-identity.ts').includes('doom-room-selections-owner:'));
  assert.ok(!read('src/preparation-identity.ts').includes('aoty'));
  assert.ok(read('DOCS.md').includes('## Move from Listening Room'));
});

test('identities owned by other systems stay unchanged', () => {
  assert.ok(read('src/shared-list.ts').includes("format: z.literal('sushe-listening-room')"));
});

test('active browser and backend copy does not reintroduce event branding or ambiguous action labels', () => {
  const stale = ['Albums of the Year', 'Saved list', 'Play next', 'Make next', 'Reveal song', 'Keep them guessing.', 'listening circle', "'AOTY'", "'Listening Room'"];
  function check(directory: string) {
    for (const entry of readdirSync(new URL(`../${directory}`, import.meta.url), { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) check(path);
      else if (/\.(ts|html|css|svg)$/.test(path)) for (const phrase of stale) assert.ok(!read(path).includes(phrase), `${path}: stale copy ${phrase}`);
    }
  }
  check('src'); check('web');
});

test('server fallback pages share product branding and still escape page titles and paths', () => {
  const html = errorPage('Page <missing>', '<p>Try again.</p>', '/ingress/"');
  assert.ok(html.includes(`<title>Page &lt;missing&gt; · ${productName}</title>`));
  assert.ok(html.includes('href="/ingress/&quot;/assets/'));
  assert.ok(html.includes('<p>Try again.</p>'));
});
