import * as fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, mergeConfig } from 'vitest/config'
import nodeVitestConfig from '../vitest.node.base'

export default mergeConfig(
  nodeVitestConfig,
  defineConfig({
    // Inlining the MCP SDK (below) makes Vite warn that its sourcemaps point at missing sources.
    logLevel: 'error',
    // Load `.md` imports as their text, as the esbuild config's `'.md': 'text'` loader does.
    plugins: [
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
