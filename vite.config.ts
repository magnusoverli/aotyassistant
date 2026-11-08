import { defineConfig } from 'vite';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';

export default defineConfig({
  root: 'web',
  base: './',
  build: { outDir: '../dist/web', emptyOutDir: true },
  plugins: [{
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
