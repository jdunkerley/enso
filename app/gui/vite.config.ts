import { sentryVitePlugin } from '@sentry/vite-plugin'
import react from '@vitejs/plugin-react'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import postcssNesting from 'postcss-nesting'
import { downloadEnsoEngine, findEnsoExecutable } from 'project-manager-shim'
import tailwindcss from 'tailwindcss'
import tailwindcssNesting from 'tailwindcss/nesting'
import { defaultClientConditions, defineConfig, loadEnv, type Plugin } from 'vite'
import VueDevTools from 'vite-plugin-vue-devtools'
import wasm from 'vite-plugin-wasm'
import tailwindConfig from './tailwind.config'

const isDevMode = process.env.NODE_ENV === 'development'
const isTestMode = process.env.NODE_ENV === 'test'
const IS_ELECTRON_DEV_MODE = process.env.ELECTRON_DEV_MODE === 'true'

if (isDevMode) {
  process.env.ENSO_IDE_YDOC_SERVER_URL ||= 'ws://__HOSTNAME__:5976'
  process.env.ENSO_IDE_YDOC_LS_DEBUG ||= 'true'
}

// Used by vite middleware inside devtools plugin. Specifying this by an option doesn't work when `componentInspector` is false.
process.env.LAUNCH_EDITOR ??= 'code'

// https://vitejs.dev/config/
export default defineConfig({
  ...(process.env.MODE ? { mode: process.env.MODE } : {}),
  ...(IS_ELECTRON_DEV_MODE ? { root: fileURLToPath(new URL('.', import.meta.url)) } : {}),
  cacheDir: fileURLToPath(new URL('../../node_modules/.cache/vite', import.meta.url)),
  plugins: [
    requireAgGridLicense(),
    wasm(),
    ...(isDevMode ?
      [
        await VueDevTools({
          // The JSX transform used by the inspector is causing react to complain and adds significant load time.
          componentInspector: false,
        }),
      ]
    : []),
    vue({
      customElement: ['**/components/visualizations/**', '**/components/shared/**'],
      template: {
        compilerOptions: {
          isCustomElement: (tag) => tag.startsWith('enso-'),
        },
      },
    }),
    react({
      include: [
        fileURLToPath(new URL('./src/**/*.tsx', import.meta.url)),
        fileURLToPath(new URL('./src/dashboard/**/use*.ts', import.meta.url)),
        fileURLToPath(new URL('./src/dashboard/**/*Hooks.ts', import.meta.url)),
      ],
    }),
    ...(process.env.DASHBOARD_TESTS !== 'true' ? [await projectManagerShim()] : []),
    ...((
      process.env.SENTRY_AUTH_TOKEN != null &&
      process.env.ENSO_IDE_SENTRY_ORGANIZATION != null &&
      process.env.ENSO_IDE_SENTRY_PROJECT != null
    ) ?
      [
        sentryVitePlugin({
          org: process.env.ENSO_IDE_SENTRY_ORGANIZATION,
          project: process.env.ENSO_IDE_SENTRY_PROJECT,
          ...(process.env.ENSO_IDE_VERSION != null ?
            { release: { name: process.env.ENSO_IDE_VERSION } }
          : {}),
        }),
      ]
    : []),
  ],
  optimizeDeps: {
    entries: fileURLToPath(new URL('./index.html', import.meta.url)),
    exclude: ['enso-common'],
    holdUntilCrawlEnd: true,
  },
  server: {
    warmup: {
      // Warming server up ***significantly*** speeds up execution of the first batch of tests in dev mode.
      clientFiles: [
        './src/**/*.vue',
        './src/**/*.tsx',
        './src/dashboard/hooks/**/*.ts',
        './src/dashboard/tailwind.css',
        './node_modules/@tanstack/**/*.js',
      ],
    },
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
    ...(process.env.GUI_HOSTNAME ? { host: process.env.GUI_HOSTNAME } : {}),
  },
  resolve: {
    conditions:
      isDevMode || isTestMode ?
        ['source', ...defaultClientConditions]
      : [...defaultClientConditions],
    alias: {
      '@': fileURLToPath(new URL('./src/project-view', import.meta.url)),
      '#': fileURLToPath(new URL('./src/dashboard', import.meta.url)),
      $: fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  envPrefix: 'ENSO_IDE_',
  define: {
    // Single hardcoded usage of `global` in aws-amplify.
    'global.TYPED_ARRAY_SUPPORT': true,
  },
  esbuild: {
    dropLabels: isDevMode ? [] : ['DEV'],
    supported: {
      'top-level-await': true,
    },
  },
  css: {
    postcss: {
      plugins: [tailwindcssNesting(postcssNesting()), tailwindcss(tailwindConfig)],
    },
  },
  build: {
    // dashboard chunk size is larger than the default warning limit
    chunkSizeWarningLimit: 700,
    sourcemap: true,
    rollupOptions: {
      output: {
        chunkFileNames: (chunkInfo) => {
          if (chunkInfo.name === 'config') {
            return 'assets/config.js'
          }
          return 'assets/[name]-[hash].js'
        },
        manualChunks: {
          config: ['./src/config'],
          entrypoint: ['./src/entrypoint'],
        },
      },
    },
  },
  preview: {
    port: 5173,
  },
})

/**
 * Fails the build when a release is built without an AG Grid Enterprise licence key.
 *
 * Without a key the table view falls back to AG Grid Community
 * (`src/project-view/components/shared/AgGridTableView/agGridLicense.ts`). That is the intended
 * behaviour for development, CI and third-party builds — but a *release* built that way would ship
 * a reduced table view with nothing to give it away: no watermark, no console error. So releases
 * opt in to this gate via `ENSO_IDE_REQUIRE_AG_GRID_LICENSE`, which CI sets for release packaging
 * only (see `prepare_packaging_steps` in `build_tools/build/src/ci_gen/job.rs`).
 */
function requireAgGridLicense(): Plugin {
  return {
    name: 'enso-require-ag-grid-license',
    apply: 'build',
    config(_config, { mode }) {
      const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'ENSO_IDE_')
      if (env.ENSO_IDE_REQUIRE_AG_GRID_LICENSE !== 'true') return
      // `.env` ships an empty placeholder, so merely *being set* is not enough.
      if ((env.ENSO_IDE_AG_GRID_LICENSE_KEY ?? '').trim() === '') {
        throw new Error(
          'ENSO_IDE_REQUIRE_AG_GRID_LICENSE is set, but ENSO_IDE_AG_GRID_LICENSE_KEY is empty. ' +
            'This build would silently fall back to AG Grid Community and ship a reduced table ' +
            'view. Supply the key (in CI, the `ENSO_AG_GRID_LICENSE_KEY` repository variable), or ' +
            'unset ENSO_IDE_REQUIRE_AG_GRID_LICENSE to build without AG Grid Enterprise.',
        )
      }
    },
  }
}

async function projectManagerShim(): Promise<Plugin> {
  const module = await import('./project-manager-shim-middleware')
  const projectManagerShimMiddleware = new module.ProjectManagerShimMiddleware(setupEnsoRunnerPath)

  if (isDevMode) {
    await setupEnsoRunnerPath()
  }

  return {
    name: 'project-manager-shim',
    configureServer(server) {
      server.middlewares.use(
        projectManagerShimMiddleware.handler.bind(projectManagerShimMiddleware),
      )
    },
    configurePreviewServer(server) {
      server.middlewares.use(
        projectManagerShimMiddleware.handler.bind(projectManagerShimMiddleware),
      )
    },
  }
}

async function setupEnsoRunnerPath(): Promise<void> {
  const projectRoot = fileURLToPath(new URL('../..', import.meta.url))
  let ensoExecutable = findEnsoExecutable(projectRoot)
  if (!ensoExecutable) {
    await downloadEnsoEngine(projectRoot)
    ensoExecutable = findEnsoExecutable(projectRoot)
  }
  if (ensoExecutable) {
    console.log('Found enso executable:', ensoExecutable)
    process.env.ENSO_ENGINE_PATH = ensoExecutable
  }
}
