#!/usr/bin/env node
// Formats staged Rust, Java and Scala files for the pre-commit hook.
// Invoked from `lint-staged.config.mjs`; see "Formatting hook" in
// docs/CONTRIBUTING.md.
//
//   node tools/pre-commit/format-staged.mjs rust  <files...>
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
import { dirname, join, relative, resolve } from 'node:path'
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

// The edition of the crate that owns `file`: its Cargo.toml, or the root
// `[workspace.package]` when it says `edition.workspace = true`. Passed to
// rustfmt explicitly, because a bare rustfmt falls back to `rustfmt.toml`.
function rustEdition(file) {
  const editionIn = (path) => {
    const toml = read(path)
    if (/^edition\.workspace\s*=\s*true|^edition\s*=\s*\{\s*workspace\s*=\s*true/m.test(toml)) {
      return 'workspace'
    }
    return /^edition\s*=\s*"(\d+)"/m.exec(toml)?.[1]
  }
  const rootEdition = () => {
    const toml = read('Cargo.toml')
    const at = toml.indexOf('[workspace.package]')
    const inherited = at < 0 ? undefined : /^edition\s*=\s*"(\d+)"/m.exec(toml.slice(at))?.[1]
    // Nothing in this workspace inherits today; rustfmt.toml is the last resort.
    return inherited ?? /^edition\s*=\s*"(\d+)"/m.exec(read('rustfmt.toml'))?.[1]
  }
  for (let dir = dirname(resolve(root, file)); dir.startsWith(root); dir = dirname(dir)) {
    const manifest = join(dir, 'Cargo.toml')
    if (existsSync(manifest)) {
      const e = editionIn(relative(root, manifest))
      return e === 'workspace' ? rootEdition() : e
    }
  }
  return rootEdition()
}

function rust() {
  if (!available('rustfmt')) skip('Rust', '`rustfmt` not found on PATH')
  // Each staged file is formatted through stdin: that touches only that file
  // (rustfmt on a path would also rewrite the `mod` files it declares), and
  // nothing else in the workspace is read or written.
  for (const file of files) {
    const edition = rustEdition(file)
    if (!edition) skip('Rust', `cannot find the edition for ${file}`)
    const path = resolve(root, file)
    const source = readFileSync(path)
    const r = spawnSync(
      'rustfmt',
      ['--edition', edition, '--config-path', join(root, 'rustfmt.toml'), '--emit', 'stdout'],
      { cwd: root, input: source, maxBuffer: 1 << 28 },
    )
    if (r.error) skip('Rust', `could not run rustfmt (${r.error.message})`)
    if (r.status !== 0) {
      console.error(`rustfmt could not format ${file}:
${r.stderr}`)
      process.exit(r.status ?? 1)
    }
    if (!r.stdout.equals(source)) writeFileSync(path, r.stdout)
  }
}

function javaMajor() {
  const r = capture('java', ['-version'])
  const m = /version "(\d+)/.exec(r?.stderr ?? '')
  return m ? Number(m[1]) : undefined
}

// google-java-format jars we trust, by version. Bumping the version in
// project/plugins.sbt needs the new jar's SHA-256 here (Maven Central also
// publishes it next to the jar); until then the hook skips Java with a notice.
const GJF_SHA256 = {
  '1.36.1': '25b400f003089d23cc5320cdaf1a16cabee19b8aa3434d0ff021b3d9f42154b4',
}
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

async function download(url, dest, wantSha256) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  const bytes = Buffer.from(await res.arrayBuffer())
  if (sha256(bytes) !== wantSha256) throw new Error(`${url}: checksum mismatch`)
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(`${dest}.tmp`, bytes)
  renameSync(`${dest}.tmp`, dest)
}

async function java() {
  // Same version and style as `javafmt` in sbt (project/JavaFormatter.scala):
  // Google style with import fixing, which are the CLI defaults.
  const version = /google-java-format"\s*%\s*"([^"]+)"/.exec(read('project/plugins.sbt'))?.[1]
  if (!version) skip('Java', 'cannot find the google-java-format version in project/plugins.sbt')
  const wantSha = GJF_SHA256[version]
  if (!wantSha) skip('Java', `no pinned SHA-256 for google-java-format ${version} in format-staged.mjs`)
  const major = javaMajor()
  if (!major) skip('Java', '`java` not found on PATH')
  if (major < 21) skip('Java', `google-java-format ${version} needs JDK 21 or newer (found ${major})`)
  const cache = process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache')
  const jar = join(cache, 'enso-format', `google-java-format-${version}-all-deps.jar`)
  if (!existsSync(jar) || sha256(readFileSync(jar)) !== wantSha) {
    const base = 'https://repo1.maven.org/maven2/com/google/googlejavaformat/google-java-format'
    notice(`downloading google-java-format ${version} (once) to ${jar}`)
    try {
      await download(`${base}/${version}/google-java-format-${version}-all-deps.jar`, jar, wantSha)
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
      // Resolve first, so that a launch problem (offline, resolution error) is
      // told apart from scalafmt itself rejecting a file: only the latter fails.
      const artifact = `org.scalameta:scalafmt-cli_2.13:${version}`
      const fetched = capture(cs, ['fetch', artifact])
      if (fetched?.status !== 0) {
        skip('Scala', `Coursier could not fetch scalafmt ${version} (offline?)`)
      }
      const r = run(cs, ['launch', artifact, '--', ...args])
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
