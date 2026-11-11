import { build } from 'vite';

await build({
  configFile: false,
  build: {
    ssr: 'src/sendspin-server.ts', outDir: 'dist/server', emptyOutDir: false,
    target: 'node26', minify: true,
    rolldownOptions: { output: { entryFileNames: 'sendspin-server.js', chunkFileNames: 'sendspin-[name]-[hash].js' } },
  },
  ssr: { noExternal: ['@sendspin/sendspin-js'] },
});
