/**
 * @file Vite config for the generator, used both by `vitest` (its tests) and by `vite-node` (the
 * `generate` script). It loads the GUI's TypeScript sources as the GUI's tests do: the `source`
 * export condition, and the GUI's three path aliases, restated from `app/gui/vite.config.ts`
 * (`resolve.alias`) rather than imported, since that config loads the GUI's Vue and WASM plugins.
 */
import { fileURLToPath } from 'node:url'
import { defineConfig, mergeConfig } from 'vitest/config'
import nodeVitestConfig from '../app/vitest.node.base'

const guiSrc = (path: string) => fileURLToPath(new URL(`../app/gui/src${path}`, import.meta.url))

export default mergeConfig(
  nodeVitestConfig,
  defineConfig({
    resolve: {
      conditions: ['source'],
      alias: {
        '@': guiSrc('/project-view'),
        '#': guiSrc('/dashboard'),
        $: guiSrc(''),
      },
    },
    test: {
      environment: 'node',
      include: ['generator/**/*.test.ts'],
    },
  }),
)
