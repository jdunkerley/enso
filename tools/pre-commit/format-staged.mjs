#!/usr/bin/env node
// Formats staged Rust, Java and Scala files for the pre-commit hook.
// Invoked from `lint-staged.config.mjs`; see "Formatting hook" in
// docs/CONTRIBUTING.md.
//
//   node tools/pre-commit/format-staged.mjs rust
//   node tools/pre-commit/format-staged.mjs java  <files...>
//   node tools/pre-commit/format-staged.mjs scala <files...>
//
// Contract: never fail the commit because a tool is missing or a download
// fails - print a notice and exit 0. A formatter that runs and rejects a file
// (a syntax error) does fail, because that commit would fail CI anyway.
// Tool versions come from the files CI already reads: `.scalafmt.conf`
// (scalafmt) and `project/plugins.sbt` (google-java-format).
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const [kind, ...files] = process.argv.slice(2)

const notice = (msg) => console.log(`pre-commit: ${msg}`)
const skip = (what, why) => {
  notice(`skipping ${what} formatting: ${why}. Format it before pushing, or CI will fail.`)
  process.exit(0)
}
const run = (cmd, args) => spawnSync(cmd, args, { cwd: root, stdio: 'inherit' })
const capture = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8' })
  return r.error ? undefined : r
}
const available = (cmd, args = ['--version']) => capture(cmd, args)?.status === 0
const read = (path) => readFileSync(join(root, path), 'utf8')
const fail = (r) => process.exit(r.status ?? 1)

function rust() {
  if (!available('cargo')) skip('Rust', '`cargo` not found on PATH')
  // `rustfmt <file>` alone does not know the crate's edition or module tree, so
  // use `cargo fmt`. That formats the whole workspace (about a second), which could
  // touch files that are not part of this commit: remember the working-tree
  // modifications of other Rust files and put them back afterwards.
  const lines = (args) => capture('git', args)?.stdout.split('\n').filter(Boolean) ?? []
  const staged = new Set(lines(['diff', '--cached', '--name-only', '--', '*.rs']))
  const others = lines(['diff', '--name-only', '--', '*.rs']).filter((f) => !staged.has(f))
  const saved = others.map((f) => [f, readFileSync(join(root, f))])
  const r = run('cargo', ['fmt'])
  for (const [f, bytes] of saved) {
    if (!readFileSync(join(root, f)).equals(bytes)) writeFileSync(join(root, f), bytes)
  }
  if (r.error) skip('Rust', `could not run cargo fmt (${r.error.message})`)
  if (r.status !== 0) fail(r)
}

function javaMajor() {
  const r = capture('java', ['-version'])
  const m = /version "(\d+)/.exec(r?.stderr ?? '')
  return m ? Number(m[1]) : undefined
}

async function download(url, dest) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  const bytes = Buffer.from(await res.arrayBuffer())
  const sha = await fetch(`${url}.sha1`, { signal: AbortSignal.timeout(30_000) })
  const want = (await sha.text()).trim().split(/\s+/)[0]
  if (createHash('sha1').update(bytes).digest('hex') !== want) {
    throw new Error(`${url}: checksum mismatch`)
  }
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(`${dest}.tmp`, bytes)
  renameSync(`${dest}.tmp`, dest)
}

async function java() {
  // Same version and style as `javafmt` in sbt (project/JavaFormatter.scala):
  // Google style with import fixing, which are the CLI defaults.
  const version = /google-java-format"\s*%\s*"([^"]+)"/.exec(read('project/plugins.sbt'))?.[1]
  if (!version) skip('Java', 'cannot find the google-java-format version in project/plugins.sbt')
  const major = javaMajor()
  if (!major) skip('Java', '`java` not found on PATH')
  if (major < 21) skip('Java', `google-java-format ${version} needs JDK 21 or newer (found ${major})`)
  const cache = process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache')
  const jar = join(cache, 'enso-format', `google-java-format-${version}-all-deps.jar`)
  if (!existsSync(jar)) {
    const base = 'https://repo1.maven.org/maven2/com/google/googlejavaformat/google-java-format'
    notice(`downloading google-java-format ${version} (once) to ${jar}`)
    try {
      await download(`${base}/${version}/google-java-format-${version}-all-deps.jar`, jar)
    } catch (e) {
      skip('Java', `could not download google-java-format (${e.message})`)
    }
  }
  const exports = ['api', 'file', 'parser', 'tree', 'util', 'code'].flatMap((p) => [
    '--add-exports',
    `jdk.compiler/com.sun.tools.javac.${p}=ALL-UNNAMED`,
  ])
  const r = run('java', [...exports, '-jar', jar, '--replace', ...files])
  if (r.status !== 0) fail(r)
}

function scala() {
  const version = /^version\s*=\s*"([^"]+)"/m.exec(read('.scalafmt.conf'))?.[1]
  if (!version) skip('Scala', 'cannot find `version` in .scalafmt.conf')
  const args = ['--non-interactive', '--config', '.scalafmt.conf', ...files]
  // Prefer Coursier, which fetches exactly the pinned version. A `scalafmt` on
  // PATH is used only if it reports that same version.
  for (const cs of ['cs', 'coursier']) {
    if (available(cs, ['version'])) {
      const r = run(cs, ['launch', `org.scalameta:scalafmt-cli_2.13:${version}`, '--', ...args])
      if (r.status !== 0) fail(r)
      return
    }
  }
  if (capture('scalafmt', ['--version'])?.stdout.includes(version)) {
    const r = run('scalafmt', args)
    if (r.status !== 0) fail(r)
    return
  }
  skip(
    'Scala',
    `no Coursier (\`cs\`) or scalafmt ${version} on PATH; install Coursier or run \`sbt scalafmtAll\``,
  )
}

if (kind === 'rust') rust()
else if (kind === 'java') await java()
else if (kind === 'scala') scala()
else {
  console.error('usage: format-staged.mjs rust | java <files...> | scala <files...>')
  process.exit(2)
}
