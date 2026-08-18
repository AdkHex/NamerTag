/**
 * Thin launcher for scripts/try-names.ts.
 *
 * Uses Vite's SSR module loader so the TypeScript source and the `@/` path alias resolve
 * exactly as they do in the app — no extra dependency and no duplicated build config.
 */
import { createServer } from 'vite'

const server = await createServer({
  configFile: false,
  logLevel: 'error',
  // Middleware mode with dep-scanning off: this script pulls in a couple of pure modules,
  // so crawling the whole React app for prebundling would only add startup cost (and it
  // trips over browser-only imports that never run here).
  server: { middlewareMode: true },
  optimizeDeps: { noDiscovery: true, include: [] },
  resolve: {
    alias: { '@': new URL('../src', import.meta.url).pathname },
  },
})

try {
  await server.ssrLoadModule('/scripts/try-names.ts')
} finally {
  await server.close()
}
