import { defineConfig } from 'vite';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';

export default defineConfig({
  root: 'web',
  base: './',
  build: { outDir: '../dist/web', emptyOutDir: true },
  plugins: [{
    name: 'compressed-assets',
    generateBundle(_options, bundle) {
      for (const item of Object.values(bundle)) {
        if (!/\.(js|css)$/.test(item.fileName)) continue;
        const source = item.type === 'chunk' ? item.code : item.source;
        const bytes = typeof source === 'string' ? Buffer.from(source) : source;
        this.emitFile({ type: 'asset', fileName: `${item.fileName}.gz`, source: gzipSync(bytes) });
        this.emitFile({ type: 'asset', fileName: `${item.fileName}.br`, source: brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }) });
      }
    },
  }],
});
