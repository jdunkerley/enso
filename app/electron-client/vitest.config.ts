import * as fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Logger } from 'vite'
import { defineConfig, mergeConfig } from 'vitest/config'
import nodeVitestConfig from '../vitest.node.base'

const MISSING_SOURCES = /^Sourcemap for .* points to missing source files$/

/**
 * Drops one warning from Vite's logger: inlining the MCP SDK (below) makes Vite warn that its
 * sourcemaps point at missing sources, which is true and harmless. Every other message passes.
 * Vitest 3 replaces any `customLogger` with its own, so the resolved config's logger is wrapped
 * instead; Vite reports this warning through `warnOnce`.
 */
function dropMissingSourcesWarning(logger: Logger): void {
  const warn = logger.warn.bind(logger)
  const warnOnce = logger.warnOnce.bind(logger)
  logger.warn = (message, options) => {
    if (!MISSING_SOURCES.test(message)) warn(message, options)
  }
  logger.warnOnce = (message, options) => {
    if (!MISSING_SOURCES.test(message)) warnOnce(message, options)
  }
}

export default mergeConfig(
  nodeVitestConfig,
  defineConfig({
    plugins: [
      {
        name: 'drop-missing-sources-warning',
        configResolved: (config) => dropMissingSourcesWarning(config.logger),
      },
      // Load `.md` imports as their text, as the esbuild config's `'.md': 'text'` loader does.
      {
        name: 'markdown-as-text',
        transform(_code, id) {
          if (!id.endsWith('.md')) return undefined
          return {
            code: `export default ${JSON.stringify(fs.readFileSync(id, 'utf8'))}`,
            map: null,
          }
        },
      },
    ],
    test: {
      // Increase the default test timeout to accommodate longer-running tests.
      testTimeout: 120_000,
      // The MCP SDK's client reaches `eventsource-parser`, whose `source` export is a `.ts` file
      // that the shared `source` condition selects; Node cannot run it from `node_modules`, so
      // Vite transforms both.
      server: { deps: { inline: [/eventsource-parser/, /@modelcontextprotocol\/sdk/] } },
      include: ['tests/headless/**/*.test.ts'],
      silent: 'passed-only',
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
  }),
)
