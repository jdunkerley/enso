import * as fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, mergeConfig } from 'vitest/config'
import nodeVitestConfig from '../vitest.node.base'

export default mergeConfig(
  nodeVitestConfig,
  defineConfig({
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
