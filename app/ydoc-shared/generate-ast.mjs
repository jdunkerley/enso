import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(dir, '../..')
const require = createRequire(import.meta.url)

const tmp = mkdtempSync(join(tmpdir(), 'enso-schema-'))
const schemaFile = join(tmp, 'schema.json')
const outputFile = join(dir, 'src', 'ast', 'generated', 'ast.ts')
// Compile into a subdir of ydoc-shared so Node inherits the "type":"module" from package.json.
const codetmp = join(dir, 'parser-codegen', '.compiled')

try {
  mkdirSync(codetmp, { recursive: true })

  // Compile parser-codegen TypeScript to JS (same as Bazel's ts_project step).
  const tscPkg = require.resolve('typescript/package.json')
  const tscBin = join(dirname(tscPkg), 'bin', 'tsc')
  run(process.execPath, [tscBin, '-p', join(dir, 'parser-codegen', 'tsconfig.json'), '--outDir', codetmp])

  // Build and run the Rust schema generator.
  run('cargo', ['run', '-p', 'enso-parser-schema', '--', schemaFile], repoRoot)

  // Generate ast.ts from the schema using the compiled codegen.
  run(process.execPath, [join(codetmp, 'index.js'), schemaFile, outputFile])
} finally {
  rmSync(tmp, { recursive: true, force: true })
  rmSync(codetmp, { recursive: true, force: true })
}

function run(cmd, args, cwd = dir) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', cwd })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
