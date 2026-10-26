import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { productName, productDescription, productTagline } from '../src/product.js';
import { errorPage } from '../src/error-page.js';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('documentation and distribution metadata describe the same music-sharing product', () => {
  assert.equal(productName, 'Listening Room');
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

test('the display rename preserves installation, browser and retained-draft identities', () => {
  assert.equal(JSON.parse(read('package.json')).name, 'albums-of-the-year');
  assert.match(read('config.yaml'), /^slug: albums_of_the_year$/m);
  assert.match(read('config.yaml'), /^image: ghcr\.io\/magnusoverli\/aotyassistant$/m);
  assert.ok(read('src/http.ts').includes("cookie(req, 'aoty_participant')"));
  assert.ok(read('src/preparation-http.ts').includes("const cookieName = 'aoty_preparation'"));
  assert.ok(read('src/ma-authorization.ts').includes("const cookieName = 'aoty_ma_login'"));
  assert.ok(read('web/preparation-controller.ts').includes('aoty.preparation-pending.v1.'));
  assert.ok(read('web/upload-panel.ts').includes('aoty.upload-draft.v1.'));
  assert.ok(read('web/record-labels.ts').includes('aoty.public-record-labels.v1'));
  assert.ok(read('DOCS.md').includes('does not require rejoining or reconnecting Music Assistant'));
});

test('active browser and backend copy does not reintroduce event branding or ambiguous action labels', () => {
  const stale = ['Albums of the Year', 'Saved list', 'Play next', 'Make next', 'Reveal song', 'Keep them guessing.', 'listening circle', "'AOTY'"];
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
