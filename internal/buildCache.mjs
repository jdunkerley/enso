import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'

// Shared input-hashing helper for the codegen scripts that `pnpm install` runs
// (WASM parser bindings, generated `ast.ts`). Building those needs a full Cargo
// compile, and `pnpm install` / `pnpm -r compile` run on nearly every CI job as
// well as on every local dependency install, so a stamp of the inputs lets an
// unchanged tree skip the rebuild entirely.
//
// Deliberately dependency-free and standalone — it is imported by lifecycle
// scripts that run before (and regardless of) `pnpm install`.

const SKIP_DIRS = new Set(['node_modules', 'target', 'dist'])

/** Recursively collect files under `root` (a file or a directory). */
function collectFiles(root, acc) {
  let stats
  try {
    stats = statSync(root)
  } catch {
    return acc
  }
  if (stats.isFile()) {
    acc.push(root)
  } else if (stats.isDirectory()) {
    for (const name of readdirSync(root).sort()) {
      if (name.startsWith('.') || SKIP_DIRS.has(name)) continue
      collectFiles(join(root, name), acc)
    }
  }
  return acc
}

/**
 * A stable sha256 over the relative path and content of every file reachable
 * from `inputs` (each entry a path relative to `baseDir`, file or directory).
 * `node_modules`, Cargo/build `target`, `dist` and dot-entries are ignored.
 */
export function hashInputs(baseDir, inputs) {
  const files = []
  for (const input of inputs) collectFiles(join(baseDir, input), files)
  files.sort()

  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(relative(baseDir, file).split(sep).join('/'))
    hash.update('\0')
    hash.update(readFileSync(file))
    hash.update('\0')
  }
  return hash.digest('hex')
}

/**
 * True when `stampPath` records exactly `expectedHash` and every path in
 * `requiredOutputs` exists — i.e. a previous build with the same inputs is
 * already in place and this one can be skipped.
 */
export function isUpToDate(stampPath, expectedHash, requiredOutputs = []) {
  if (!existsSync(stampPath)) return false
  if (requiredOutputs.some((output) => !existsSync(output))) return false
  try {
    return readFileSync(stampPath, 'utf8').trim() === expectedHash
  } catch {
    return false
  }
}

/** Record `hash` at `stampPath`, creating parent directories as needed. */
export function writeStamp(stampPath, hash) {
  mkdirSync(dirname(stampPath), { recursive: true })
  writeFileSync(stampPath, `${hash}\n`)
}
