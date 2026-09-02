import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hashInputs, isUpToDate, writeStamp } from '../../internal/buildCache.mjs'

const dir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(dir, '../..')
const require = createRequire(import.meta.url)

const tmp = mkdtempSync(join(tmpdir(), 'enso-schema-'))
const schemaFile = join(tmp, 'schema.json')
const outputFile = join(dir, 'src', 'ast', 'generated', 'ast.ts')
// Compile into a subdir of ydoc-shared so Node inherits the "type":"module" from package.json.
const codetmp = join(dir, 'parser-codegen', '.compiled')

// Skip the (Cargo-heavy) schema regeneration when the parser sources and the
// codegen are unchanged and `ast.ts` is still in place. Set
// `ENSO_FORCE_AST_GEN=1` to override.
// Not dot-prefixed: `actions/upload-artifact` drops hidden files by default, and this stamp
// must travel inside the `wasm-artifacts` bundle.
const stampFile = join(dir, 'src', 'ast', 'generated', 'ast-gen.stamp')
const inputHash = hashInputs(repoRoot, [
  'lib/rust',
  'app/ydoc-shared/parser-codegen',
  'app/ydoc-shared/generate-ast.mjs',
  'Cargo.toml',
  'Cargo.lock',
  'rust-toolchain.toml',
])
if (!process.env.ENSO_FORCE_AST_GEN && isUpToDate(stampFile, inputHash, [outputFile])) {
  console.log('ydoc-shared: generated ast.ts is up to date, skipping generation.')
  rmSync(tmp, { recursive: true, force: true })
  process.exit(0)
}

try {
  mkdirSync(codetmp, { recursive: true })

  // Compile parser-codegen TypeScript to JS (same as Bazel's ts_project step).
  const tscPkg = require.resolve('typescript/package.json')
  const tscBin = join(dirname(tscPkg), 'bin', 'tsc')
  run(process.execPath, [
    tscBin,
    '-p',
    join(dir, 'parser-codegen', 'tsconfig.json'),
    '--outDir',
    codetmp,
  ])

  // Build and run the Rust schema generator.
  run('cargo', ['run', '-p', 'enso-parser-schema', '--', schemaFile], repoRoot)

  // Generate ast.ts from the schema using the compiled codegen.
  run(process.execPath, [join(codetmp, 'index.js'), schemaFile, outputFile])

  writeStamp(stampFile, inputHash)
} finally {
  rmSync(tmp, { recursive: true, force: true })
  rmSync(codetmp, { recursive: true, force: true })
}

function run(cmd, args, cwd = dir) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', cwd })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
