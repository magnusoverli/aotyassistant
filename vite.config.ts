import { defineConfig } from 'vite';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
const release = `v${version.replaceAll('.', '-')}`; // Asset routes allow only letters, digits, - and _.

export default defineConfig({
  root: 'web',
  base: './',
  build: {
    outDir: '../dist/web', emptyOutDir: true,
    target: 'baseline-widely-available',
    manifest: true,
    // Browsers keep hashed assets for a year without asking again. The version in every
    // name means no release can reuse a cached file from an earlier one (1.1.17 served
    // broken copies under names that 1.1.18 kept, because their content was unchanged).
    rolldownOptions: { output: {
      entryFileNames: `assets/[name]-${release}-[hash].js`, chunkFileNames: `assets/[name]-${release}-[hash].js`,
      assetFileNames: `assets/[name]-${release}-[hash][extname]`,
    } },
  },
  plugins: [{
    name: 'preloaded-fonts',
    // The first screen's fonts are named only inside the stylesheet. Ask for them with it,
    // not one round trip after it, so text does not change typeface once the page is up.
    transformIndexHtml: { order: 'post', handler(_html, context) {
      return Object.keys(context.bundle ?? {}).filter(name => /^assets\/(?:inter-latin-wght-normal|grenze-latin-600-normal)-[\w-]+\.woff2$/.test(name)).sort()
        .map(name => ({ tag: 'link', attrs: { rel: 'preload', as: 'font', type: 'font/woff2', href: `./${name}`, crossorigin: true }, injectTo: 'head' as const }));
    } },
  }, {
    name: 'compressed-assets',
    // Compress the files as written. Vite fills in lazy-import placeholders after
    // generateBundle, so compressing earlier would serve unfinished code.
    async writeBundle(options, bundle) {
      for (const item of Object.values(bundle)) {
        if (!/\.(js|css)$/.test(item.fileName)) continue;
        const path = resolve(options.dir!, item.fileName); const bytes = await readFile(path);
        if (bytes.includes('__VITE_PRELOAD__')) this.error(`${item.fileName} still contains a Vite preload placeholder.`);
        await writeFile(`${path}.gz`, gzipSync(bytes));
        await writeFile(`${path}.br`, brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }));
      }
    },
  }],
});
