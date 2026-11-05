/** @file Esbuild config file. */
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

import type * as esbuild from 'esbuild'
import { wasmLoader } from 'esbuild-plugin-wasm'

import * as paths from './paths'

/**
 * Get the bundler options using the environment.
 *
 * The following environment variables are required:
 * - `ENSO_BUILD_IDE` - output directory for bundled client files;
 * @see bundlerOptions
 */
export function bundlerOptionsFromEnv(devMode = false): esbuild.BuildOptions {
  return bundlerOptions(path.join(paths.getIdeDirectory(), 'client'), devMode)
}

/** Get options without relying on the environment. */
export function bundlerOptions(outdir: string, devMode = false): esbuild.BuildOptions {
  return {
    bundle: true,
    outdir,
    // `ydocHost.mjs` is the ydoc server's utility process (`src/ydocHost/`). It is bundled beside
    // `index.mjs`, not in a subdirectory: `esbuild-plugin-wasm` resolves the WASM file's path against
    // the bundle only when it starts with `./`.
    entryPoints: [
      'src/index.ts',
      'src/preload.ts',
      { in: 'src/ydocHost/main.ts', out: 'ydocHost' },
    ],
    outbase: 'src',
    format: 'esm',
    platform: 'node',
    outExtension: { '.js': '.mjs' },
    plugins: [wasmLoader()],
    // Native addons (`@napi-rs/keyring`'s per-platform binary) are copied next to the bundle and
    // `require`d from there; electron-builder unpacks them from the asar (`asarUnpack`), since a
    // `.node` file cannot be loaded from inside one.
    loader: { '.node': 'copy' },
    target: ['node20'], // electron31
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
    define: {
      'process.env.ELECTRON_DEV_MODE': JSON.stringify(String(devMode)),
      'process.env.ENSO_IDE_VERSION': JSON.stringify(process.env.ENSO_IDE_VERSION),
      'process.env.ENSO_IDE_UPDATES': JSON.stringify(process.env.ENSO_IDE_UPDATES),
      'process.env.ENSO_IDE_COMMIT_HASH': JSON.stringify(process.env.ENSO_IDE_COMMIT_HASH),
    },
    sourcemap: 'linked',
    external: ['electron', 'vite', 'lightningcss', 'original-fs'],
  }
}
