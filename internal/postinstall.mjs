import { spawnSync } from 'node:child_process'
import process from 'node:process'

// On Windows, pnpm is a .cmd file and requires shell dispatch.
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

function run(args) {
  const result = spawnSync(pnpm, args, { stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

// Generate TypeScript AST types from the Rust parser schema (requires Cargo).
run(['--filter', 'ydoc-shared', 'run', 'generate-ast'])
// Generate icon name list from icons.svg.
run(['--filter', 'enso-gui', 'run', 'generate-icons'])
// Generate Lezer parser from the table-expression grammar file.
run(['--filter', 'lezer-enso-table-expr', 'run', 'generate-parser'])
