import { sentryVitePlugin } from '@sentry/vite-plugin'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import postcssNesting from 'postcss-nesting'
import { findEnsoExecutable } from 'project-manager-shim'
import { loopbackOrigins, type YdocHost } from 'project-manager-shim/projectService'
import tailwindcss from 'tailwindcss'
import tailwindcssNesting from 'tailwindcss/nesting'
import {
  defaultClientConditions,
  defineConfig,
  type Connect,
  type Plugin,
  type ViteDevServer,
} from 'vite'
import VueDevTools from 'vite-plugin-vue-devtools'
import wasm from 'vite-plugin-wasm'
import tailwindConfig from './tailwind.config'

const isDevMode = process.env.NODE_ENV === 'development'
const isTestMode = process.env.NODE_ENV === 'test'
const IS_ELECTRON_DEV_MODE = process.env.ELECTRON_DEV_MODE === 'true'

if (isDevMode) {
  // The GUI takes each project's ydoc address from `project/open`; the shim middleware hosts the
  // ydoc server in this process (`project-manager-shim-middleware`).
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
    wasm(),
    ...(isDevMode ?
      [
        await VueDevTools({
          // The component inspector adds significant load time.
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

async function projectManagerShim(): Promise<Plugin> {
  const module = await import('./project-manager-shim-middleware')
  const projectManagerShimMiddleware = new module.ProjectManagerShimMiddleware(setupEnsoRunnerPath)
  /** Serve the shim's routes on a server configured with `host`. */
  const middleware =
    (host: string | boolean | undefined): Connect.NextHandleFunction =>
    (request, response, next) =>
      projectManagerShimMiddleware.handler(
        request,
        response,
        next,
        typeof host === 'string' ? [host] : [],
      )

  if (isDevMode) {
    // Warn now; the first project-service request fails with the same message.
    await setupEnsoRunnerPath().catch((error: Error) => console.warn(`\n⚠️  ${error.message}\n`))
  }

  return {
    name: 'project-manager-shim',
    configureServer(server) {
      projectManagerShimMiddleware.ydocHost = ssrYdocHost(server)
      server.middlewares.use(middleware(server.config.server.host))
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware(server.config.preview.host))
    },
  }
}

/**
 * The ydoc server hosted in the dev server's Node (spec stage 1a of the JVM-by-default plan), as
 * Electron hosts it in a utility process. `ydoc-server` is loaded through Vite's SSR loader, on the
 * first open: its compiled `dist/` does not run in plain Node (extensionless imports, and
 * `rust-ffi`'s WASM import), and the config bundle leaves it external.
 */
function ssrYdocHost(server: ViteDevServer): YdocHost {
  let host: Promise<YdocHost> | undefined
  const get = () =>
    (host ??= server
      .ssrLoadModule('ydoc-server')
      .then((module) => new (module as typeof import('ydoc-server')).NodeYdocHost())
      .catch((error: unknown) => {
        // Not cached: the next open loads it again (a failed SSR transform need not be permanent).
        host = undefined
        throw error
      }))
  return {
    listen: async (request) =>
      (await get()).listen({
        ...request,
        allowedOrigins: request.allowedOrigins ?? devServerOrigins(server),
      }),
    close: async (port) => (await get()).close(port),
  }
}

/**
 * The origins the dev server's pages are loaded from, whose sockets a ydoc listener accepts (any
 * other browser origin is refused, #596): the addresses Vite prints, and the port under every
 * loopback name. Read at each open, once the server is listening. A page opened by the machine's
 * host name, through `server.origin` or a reverse proxy is refused: add its origin here.
 */
function devServerOrigins(server: ViteDevServer): string[] {
  const urls = [...(server.resolvedUrls?.local ?? []), ...(server.resolvedUrls?.network ?? [])]
  const address = server.httpServer?.address()
  const port = typeof address === 'object' && address != null ? address.port : undefined
  const protocol = server.config.server.https ? 'https:' : 'http:'
  return [...urls, ...(port != null ? loopbackOrigins(protocol, port) : [])]
}

/**
 * Point the shim at the checkout's engine. Nothing is downloaded (#359): an engine from elsewhere
 * would not match the checkout.
 */
async function setupEnsoRunnerPath(): Promise<void> {
  const projectRoot = fileURLToPath(new URL('../..', import.meta.url))
  const ensoExecutable = findEnsoExecutable(projectRoot)
  if (!ensoExecutable) {
    throw new Error(
      'No Enso engine found in built-distribution/ or ENSO_ENGINE_PATH. ' +
        'Build one with `sbt buildEngineDistribution`.',
    )
  }
  console.log('Found enso executable:', ensoExecutable)
  process.env.ENSO_ENGINE_PATH = ensoExecutable
}
