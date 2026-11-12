/**
 * @file The packaged engine runs from a path outside the Windows ANSI code page (#693): the bundled
 * `java.exe` carries a UTF-8 `activeCodePage` manifest (Note [The Bundled java.exe Uses UTF-8] in
 * `project/JavaUtf8Manifest.scala`), so the JVM's own options (`--module-path`, `-XX:AOTCache=`)
 * keep characters such as `Ł` and `漢` that code page 1252 lacks. Without it `java` fails at boot
 * with `InvalidPathException: Illegal char <?>`.
 *
 * The engine is reached through a junction named `Łukasz 漢` (the runner's user name is ASCII) and
 * started with the shim's own command line (`javaCommand`, `aotCreateArguments`): a junction is
 * used as it is, while the shim resolves the engine's real path (`enginePathsSync`). On CI the
 * unpacked IDE itself also sits under such a directory, so every packaged-IDE spec opens its
 * projects with an engine there (`ENSO_TEST_NON_ANSI_INSTALL`, `ide-packaging.yml`).
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from 'playwright/test'
import { aotCreateArguments, javaCommand, type JavaEngine } from 'project-manager-shim/jvmAot'
import { engineBundleRoot } from './packagedIde'

/** A name with a character from Latin Extended-A and one from CJK, both outside code page 1252. */
const NON_ANSI = 'Łukasz 漢'

/** What the test project prints; its file name and text are outside the code page too. */
const MAIN = `\
from Standard.Base import all

main =
    file = enso_project.root / "Łukasz-漢.txt"
    "zażółć 漢字" . write file
    names = enso_project.root.list . map .name
    IO.println "root="+enso_project.root.path
    IO.println "text="+file.read_text
    IO.println "listed="+(names.contains "Łukasz-漢.txt").to_text
`

test.skip(process.platform !== 'win32', 'The ANSI code page is a Windows limit.')

interface Result {
  readonly code: number | null
  readonly output: string
}

/** Runs `command` to its end; stdout and stderr together, decoded as UTF-8. */
function run(
  [command, args]: readonly [string, readonly string[]],
  options: { cwd: string },
): Promise<Result> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.on('error', reject)
    child.on('close', (code: number | null) =>
      resolve({ code, output: Buffer.concat(chunks).toString('utf8') }),
    )
  })
}

let scratch: string
let root: string
let engine: JavaEngine

test.beforeAll(() => {
  const bundle = engineBundleRoot()
  if (bundle == null) throw new Error('The packaged IDE has no engine bundle.')
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'enso-non-ansi-'))
  root = path.join(scratch, NON_ANSI)
  fs.mkdirSync(root)
  const link = path.join(root, 'enso')
  fs.symlinkSync(bundle, link, 'junction')
  const [version] = fs.readdirSync(path.join(link, 'dist'))
  const [runtime] = fs.readdirSync(path.join(link, 'runtime'))
  if (version == null || runtime == null) throw new Error(`No engine or runtime in ${bundle}.`)
  engine = {
    javaExecutable: path.join(link, 'runtime', runtime, 'bin', 'java.exe'),
    engineRoot: path.join(link, 'dist', version),
  }
})

test.afterAll(() => {
  if (scratch == null) return
  // The junction first, on its own: removing it never touches the bundle it points to.
  const link = path.join(root, 'enso')
  if (fs.existsSync(link)) fs.rmdirSync(link)
  fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
})

test('the unpacked IDE is under a non-ANSI path on CI', () => {
  test.skip(process.env.ENSO_TEST_NON_ANSI_INSTALL !== '1', 'Set by ide-packaging.yml only.')
  const bundle = engineBundleRoot()
  expect(bundle && fs.realpathSync(bundle)).toContain(NON_ANSI)
})

test('the engine starts with its module path outside the ANSI code page', async () => {
  test.setTimeout(120_000)
  const result = await run(javaCommand(engine, ['--version']), { cwd: root })
  expect(result.output).not.toContain('InvalidPathException')
  expect(result.code, result.output).toBe(0)
})

test('an AOT cache outside the ANSI code page is created and used', async () => {
  test.setTimeout(300_000)
  const config = path.join(root, 'enso.aotconf')
  const cache = path.join(root, 'enso.aot')
  const record = await run(
    javaCommand(engine, ['--version'], {
      extraJvmOptions: ['-XX:AOTMode=record', `-XX:AOTConfiguration=${config}`],
    }),
    { cwd: root },
  )
  expect(record.code, record.output).toBe(0)
  const create = await run([engine.javaExecutable, aotCreateArguments(engine, { config, cache })], {
    cwd: root,
  })
  expect(create.code, create.output).toBe(0)
  expect(fs.existsSync(cache), create.output).toBe(true)
  // `AOTMode=on` fails the JVM when the cache cannot be mapped.
  const use = await run(
    javaCommand(engine, ['--version'], {
      extraJvmOptions: [`-XX:AOTCache=${cache}`, '-XX:AOTMode=on'],
    }),
    { cwd: root },
  )
  expect(use.code, use.output).toBe(0)
})

test('a project outside the ANSI code page is created and run', async () => {
  test.setTimeout(600_000)
  const projects = path.join(root, 'projects')
  fs.mkdirSync(projects)
  const project = path.join(projects, 'Uni_Test')
  const created = await run(javaCommand(engine, ['--new', project]), { cwd: projects })
  expect(created.code, created.output).toBe(0)
  fs.writeFileSync(path.join(project, 'src', 'Main.enso'), MAIN)
  // The engine's working directory is the project's parent, as the shim starts it.
  // As the test jobs run the engine: with assertions (`EnsoContext.checkWorkingDirectory` among
  // them), but not Truffle's `HostExecuteNode` one (#36) or GraalPy's.
  const ran = await run(
    javaCommand(engine, ['--run', project], {
      extraJvmOptions: [
        '-enableassertions',
        '-da:com.oracle.truffle.host.HostExecuteNode',
        '-da:com.oracle.graal.python.runtime.ExecutionContext',
      ],
    }),
    { cwd: projects },
  )
  expect(ran.code, ran.output).toBe(0)
  expect(ran.output).toContain(`root=${project}`)
  expect(ran.output).toContain('text=zażółć 漢字')
  expect(ran.output).toContain('listed=True')
})
