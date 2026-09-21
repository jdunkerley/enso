import { spawnSync } from 'node:child_process'
import process from 'node:process'

// Re-invoke the package manager that ran us via `npm_execpath`, which is set for every
// lifecycle script. This avoids depending on `pnpm`/`pnpm.cmd` being resolvable on PATH, and
// sidesteps Node's refusal to spawn `.cmd` files directly on Windows (CVE-2024-27980 fix).
//
// What `npm_execpath` points at depends on the pnpm version: up to pnpm 10 it is a JS entry
// point, which has to be run as `node <path>`; pnpm 12 points it at a native binary
// (`pnpm-native.exe` on Windows), which Node can neither import nor run that way — it must be
// spawned directly. Dispatch on the extension rather than the version.
const npmExecpath = process.env.npm_execpath
const npmExecpathIsJs = npmExecpath != null && /\.[cm]?js$/i.test(npmExecpath)

function run(args) {
  const [cmd, cmdArgs, shell] =
    npmExecpathIsJs ? [process.execPath, [npmExecpath, ...args], false]
      // A real executable, so the `.cmd` spawn restriction above does not apply to it.
    : npmExecpath != null ? [npmExecpath, args, false]
    : [process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', args, process.platform === 'win32']
  const result = spawnSync(cmd, cmdArgs, { stdio: 'inherit', shell })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

// Build the Rust parser to WASM + wasm-bindgen bindings (requires Cargo).
run(['--filter', 'rust-ffi', 'run', 'build-wasm'])
// Generate TypeScript AST types from the Rust parser schema (requires Cargo).
run(['--filter', 'ydoc-shared', 'run', 'generate-ast'])
// Generate icon name list from icons.svg.
run(['--filter', 'enso-gui', 'run', 'generate-icons'])
// Generate Lezer parser from the table-expression grammar file.
run(['--filter', 'lezer-enso-table-expr', 'run', 'generate-parser'])
