/**
 * @file Vite config for the generator, used both by `vitest` (its tests) and by `vite-node` (the
 * `generate` script). It loads the GUI's TypeScript sources as the GUI's tests do: the `source`
 * export condition, and the GUI's three path aliases, restated from `app/gui/vite.config.ts`
 * (`resolve.alias`) rather than imported, since that config loads the GUI's Vue and WASM plugins.
 */
import { fileURLToPath } from 'node:url'
import wasm from 'vite-plugin-wasm'
import { defineConfig, mergeConfig, type Plugin } from 'vitest/config'
import nodeVitestConfig from '../app/vitest.node.base'

const guiSrc = (path: string) => fileURLToPath(new URL(`../app/gui/src${path}`, import.meta.url))

/**
 * The parser behind `exampleToNodes` (the style check) is a WASM module. `vite-plugin-wasm` inlines
 * it for Node only when it is told the load is SSR, which vitest is detected for and `vite-node`
 * (the `generate` script) is not: it would try to `fetch` the module's `/@fs/` URL. Both run in
 * Node here, so always say so.
 */
function wasmForNode(): Plugin {
  const plugin = wasm()
  const load = plugin.load
  if (typeof load !== 'function') throw new Error('vite-plugin-wasm: load is not a function')
  return {
    ...plugin,
    load(id) {
      return load.call(this, id, { ssr: true })
    },
  }
}

export default mergeConfig(
  nodeVitestConfig,
  defineConfig({
    plugins: [wasmForNode()],
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
