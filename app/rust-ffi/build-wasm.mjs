import { spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { hashInputs, isUpToDate, writeStamp } from '../../internal/buildCache.mjs'

// Builds `enso-parser` (via this crate) to WebAssembly and generates the
// `wasm-bindgen` bundler bindings into `dist/`, which `ydoc-shared` consumes as
// the `rust-ffi` package. Replaces the former Bazel `rust_wasm_bindgen` target.

const dir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(dir, '../..')

// Skip the (Cargo-heavy) rebuild when the Rust sources feeding it are unchanged
// and the previous output is still in place. Set `ENSO_FORCE_WASM_BUILD=1` to
// override.
const stampFile = join(dir, 'dist', '.input-stamp')
const stampInputs = [
  'lib/rust',
  'app/rust-ffi/src',
  'app/rust-ffi/Cargo.toml',
  'app/rust-ffi/build-wasm.mjs',
  'Cargo.toml',
  'Cargo.lock',
  'rust-toolchain.toml',
]
const inputHash = hashInputs(repoRoot, stampInputs)
const expectedOutputs = [join(dir, 'dist', 'rust_ffi.js'), join(dir, 'dist', 'rust_ffi_bg.wasm')]
if (!process.env.ENSO_FORCE_WASM_BUILD && isUpToDate(stampFile, inputHash, expectedOutputs)) {
  console.log('rust-ffi: WASM bindings are up to date, skipping build.')
  process.exit(0)
}

// MUST match the `wasm-bindgen` crate pin in `Cargo.toml` — a mismatched CLI
// emits bindings against an incompatible ABI and breaks the GUI build.
const WASM_BINDGEN_VERSION = '0.2.100'
const WASM_TARGET = 'wasm32-unknown-unknown'

const cargoBin = join(process.env.CARGO_HOME ?? join(homedir(), '.cargo'), 'bin')
// Freshly `cargo install`ed binaries land in `cargoBin`, which is not always on
// the PATH inherited by lifecycle scripts; prepend it so the same run finds them.
const env = { ...process.env, PATH: `${cargoBin}${delimiter}${process.env.PATH ?? ''}` }
const exe = (name) => (process.platform === 'win32' ? `${name}.exe` : name)

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', cwd: repoRoot, env, ...opts })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function installedWasmBindgenVersion() {
  const r = spawnSync(exe('wasm-bindgen'), ['--version'], { encoding: 'utf8', env })
  if (r.error || r.status !== 0) return null
  return r.stdout.trim().split(/\s+/)[1] ?? null
}

function cargoTargetDir() {
  const r = spawnSync('cargo', ['metadata', '--format-version', '1', '--no-deps'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env,
    maxBuffer: 64 * 1024 * 1024,
  })
  if (r.error || r.status !== 0) throw new Error('`cargo metadata` failed')
  return JSON.parse(r.stdout).target_directory
}

// Ensure the wasm target is available (no-op if already added, skipped if the
// toolchain is not managed by rustup).
if (spawnSync(exe('rustup'), ['--version'], { env }).status === 0) {
  run(exe('rustup'), ['target', 'add', WASM_TARGET])
}

// Ensure the pinned wasm-bindgen CLI is available.
if (installedWasmBindgenVersion() !== WASM_BINDGEN_VERSION) {
  console.log(`Installing wasm-bindgen-cli ${WASM_BINDGEN_VERSION} ...`)
  run('cargo', ['install', 'wasm-bindgen-cli', '--version', WASM_BINDGEN_VERSION, '--locked'])
}

run('cargo', ['build', '-p', 'rust-ffi', '--target', WASM_TARGET, '--release'])

const wasmFile = join(cargoTargetDir(), WASM_TARGET, 'release', 'rust_ffi.wasm')
if (!existsSync(wasmFile)) {
  console.error(`Expected wasm artifact not found: ${wasmFile}`)
  process.exit(1)
}
// Start clean — a previous Bazel build leaves the outputs read-only.
const distDir = join(dir, 'dist')
rmSync(distDir, { recursive: true, force: true })
run(exe('wasm-bindgen'), [wasmFile, '--target', 'bundler', '--out-dir', distDir])

writeStamp(stampFile, inputHash)
