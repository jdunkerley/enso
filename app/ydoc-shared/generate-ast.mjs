import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(dir, '../..')
const require = createRequire(import.meta.url)
const viteNodeBin = require.resolve('vite-node/vite-node.mjs')

const tmp = mkdtempSync(join(tmpdir(), 'enso-schema-'))
const schemaFile = join(tmp, 'schema.json')
const outputFile = join(dir, 'src', 'ast', 'generated', 'ast.ts')

try {
  run('cargo', ['run', '-p', 'enso-parser-schema', '--', schemaFile], repoRoot)
  run(process.execPath, [viteNodeBin, join(dir, 'parser-codegen', 'index.ts'), schemaFile, outputFile])
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

function run(cmd, args, cwd = dir) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', cwd })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
