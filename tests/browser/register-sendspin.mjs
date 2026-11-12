// The browser tests' server imports @sendspin/sendspin-js, whose published ES modules import each other
// without file extensions ("./core/core"), which Node's own loader rejects. Only those imports, and only
// from inside that package, get ".js" (or "/index.js") added. Loaded by playwright.config.ts and, through
// NODE_OPTIONS, by its workers.
import { registerHooks } from 'node:module';

// Module URLs always use forward slashes, also on Windows.
const sendspin = /\/@sendspin\/sendspin-js\//;
registerHooks({
  resolve(specifier, context, next) {
    try { return next(specifier, context); } catch (error) {
      if (error?.code !== 'ERR_MODULE_NOT_FOUND' || !specifier.startsWith('.') || /\.[cm]?js$/.test(specifier) || !sendspin.test(decodeURIComponent(context.parentURL ?? ''))) throw error;
      try { return next(`${specifier}.js`, context); } catch { return next(`${specifier}/index.js`, context); }
    }
  },
});
