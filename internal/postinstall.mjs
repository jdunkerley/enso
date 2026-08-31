import { spawnSync } from 'node:child_process'
import process from 'node:process'

// Re-invoke the package manager that ran us via its JS entry point
// (`npm_execpath`, set for every lifecycle script). This avoids depending on
// `pnpm`/`pnpm.cmd` being resolvable on PATH, and sidesteps Node's refusal to
// spawn `.cmd` files directly on Windows (CVE-2024-27980 fix).
const npmExecpath = process.env.npm_execpath

function run(args) {
  const [cmd, cmdArgs, shell] =
    npmExecpath ?
      [process.execPath, [npmExecpath, ...args], false]
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
