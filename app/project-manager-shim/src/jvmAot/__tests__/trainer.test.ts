/**
 * @file The trainer with a fake bundle: a fake engine (a Node script) that makes the scratch
 * project for `--new`, and for `--server` serves the fake Language Server and, on the stdin
 * newline, writes the file named by `-XX:AOTConfiguration=` and exits; and a fake `java` that
 * writes the cache named by `-XX:AOTCache=` from that configuration. The trainer's commands are
 * replaced (`EngineTrainerOptions.commands`): the fake engine gets the JVM options of its launch
 * as a leading `--fake-jvm-options <base64 JSON>`. The command lines of the real `java` are
 * tested in `javaLaunch.test.ts`.
 */
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import * as url from 'node:url'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { JVM_AOT_TRAINER_PORT } from '../../projectService/__tests__/testPorts.js'
import { EngineTrainer } from '../trainer.js'

const FAKE_LS = url.pathToFileURL(path.join(import.meta.dirname, 'fakeLanguageServer.ts')).href
const TEMPLATE_MAIN = path.resolve(
  import.meta.dirname,
  '../../../../../lib/scala/pkg/src/main/resources/default/src/Main.enso',
)

const FAKE_ENSO = `
import * as fs from 'node:fs'
import * as path from 'node:path'
let args = process.argv.slice(2)
let jvmOptions = []
if (args[0] === '--fake-jvm-options') {
  jvmOptions = JSON.parse(Buffer.from(args[1], 'base64').toString())
  args = args.slice(2)
}
const value = (flag) => args[args.indexOf(flag) + 1]
const record = process.env.FAKE_RECORD
if (args.includes('--new')) {
  const project = value('--new')
  fs.mkdirSync(path.join(project, 'src'), { recursive: true })
  fs.writeFileSync(path.join(project, 'package.yaml'), 'name: Train\\nnamespace: local\\n')
  fs.copyFileSync(${JSON.stringify(TEMPLATE_MAIN)}, path.join(project, 'src', 'Main.enso'))
  process.exit(0)
}
fs.writeFileSync(record, JSON.stringify({
  args,
  pid: process.pid,
  jvmOptions,
  token: process.env.LANGUAGE_SERVER_CHANNEL_TOKEN ?? null,
}))
const { startFakeLanguageServer } = await import(${JSON.stringify(FAKE_LS)})
const never = process.env.FAKE_NEVER_COMPLETE === '1'
await startFakeLanguageServer({
  token: process.env.LANGUAGE_SERVER_CHANNEL_TOKEN,
  port: Number(value('--rpc-port')),
  completeAfterMs: never ? null : 100,
})
process.stdin.on('data', () => {
  const config = jvmOptions
    .find((o) => o.startsWith('-XX:AOTConfiguration='))
    .slice('-XX:AOTConfiguration='.length)
  const code = Number(process.env.FAKE_EXIT_CODE ?? '0')
  if (code === 0) fs.writeFileSync(config, 'config')
  process.exit(code)
})
`

const FAKE_JAVA = `
import * as fs from 'node:fs'
const args = process.argv.slice(2)
const option = (name) => args.find((a) => a.startsWith(name + '=')).slice(name.length + 1)
fs.writeFileSync(process.env.FAKE_JAVA_RECORD, JSON.stringify({ args }))
if (fs.readFileSync(option('-XX:AOTConfiguration'), 'utf8') !== 'config') process.exit(2)
fs.writeFileSync(option('-XX:AOTCache'), 'cache')
`

let root: string
let bundle: string

/** A launcher for `script`: a `.bat` on Windows (as the trainer expects), a shell script elsewhere. */
async function launcher(directory: string, name: string, script: string): Promise<string> {
  const scriptFile = path.join(directory, `fake-${name}.mjs`)
  await fs.writeFile(scriptFile, script)
  if (process.platform === 'win32') {
    const file = path.join(directory, `${name}.bat`)
    await fs.writeFile(file, `@"${process.execPath}" "${scriptFile}" %*\r\n`)
    return file
  }
  const file = path.join(directory, name)
  await fs.writeFile(file, `#!/bin/sh\nexec "${process.execPath}" "${scriptFile}" "$@"\n`)
  await fs.chmod(file, 0o755)
  return file
}

/** The process of a fake launcher: a `.bat` goes through `cmd.exe`. */
function run(file: string, args: readonly string[]): [string, readonly string[]] {
  return file.endsWith('.bat') ? ['cmd.exe', ['/c', file, ...args]] : [file, args]
}

interface Recorded {
  args: string[]
  pid: number
  jvmOptions: string[]
  token: string | null
}

const recordFile = () => path.join(root, 'record.json')
const javaRecordFile = () => path.join(root, 'java-record.json')
const recorded = async () => JSON.parse(await fs.readFile(recordFile(), 'utf8')) as Recorded

async function exists(file: string): Promise<boolean> {
  return fs.access(file).then(
    () => true,
    () => false,
  )
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function trainer(): Promise<EngineTrainer> {
  const engineRoot = path.join(bundle, 'enso', 'dist', '1.0')
  const bin = path.join(engineRoot, 'bin')
  const runtimeBin = path.join(bundle, 'enso', 'runtime', 'graalvm', 'bin')
  await fs.mkdir(bin, { recursive: true })
  await fs.mkdir(runtimeBin, { recursive: true })
  await fs.writeFile(path.join(engineRoot, 'jvm.options'), '# c\n-Dfrom.file=1\n')
  const fakeEnso = await launcher(bin, 'enso', FAKE_ENSO)
  const fakeJava = await launcher(runtimeBin, 'java', FAKE_JAVA)
  return new EngineTrainer({
    ensoExecutable: fakeEnso,
    commands: {
      engine: (args, jvmOptions) =>
        run(fakeEnso, [
          '--fake-jvm-options',
          Buffer.from(JSON.stringify(jvmOptions ?? [])).toString('base64'),
          ...args,
        ]),
      create: (args) => run(fakeJava, args),
    },
    scratchRoot: path.join(root, 'scratch'),
    firstPort: JVM_AOT_TRAINER_PORT,
    startupTimeoutMs: 20_000,
    driveTimeoutMs: 20_000,
    exitTimeoutMs: 20_000,
  })
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'aot-trainer-'))
  bundle = path.join(root, 'bundle')
  vi.stubEnv('FAKE_RECORD', recordFile())
  vi.stubEnv('FAKE_JAVA_RECORD', javaRecordFile())
  vi.stubEnv('ENSO_JVM_OPTIONS', '')
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

test(
  'a training writes the cache and removes the configuration and scratch directory',
  { timeout: 30_000 },
  async () => {
    const output = path.join(root, 'key dir', 'enso.aot')
    await (await trainer()).train(output, new AbortController().signal)
    expect(await fs.readFile(output, 'utf8')).toBe('cache')
    expect(await exists(`${output}.tmp`)).toBe(false)
    expect(await exists(`${output}.aotconf`)).toBe(false)
    expect(await exists(path.join(root, 'scratch'))).toBe(false)
  },
)

test(
  'the engine records, with a token and no ydoc port; java creates with the options of an engine',
  { timeout: 30_000 },
  async () => {
    vi.stubEnv('ENSO_JVM_OPTIONS', '-Dinherited=1')
    const output = path.join(root, 'key dir', 'enso.aot')
    await (await trainer()).train(output, new AbortController().signal)
    const engine = await recorded()
    expect(engine.args.slice(0, 2)).toEqual(['--server', '--root-id'])
    expect(engine.args).not.toContain('--jvm')
    expect(engine.args[engine.args.indexOf('--path') + 1]).toBe(path.join(root, 'scratch', 'Train'))
    expect(engine.jvmOptions).toEqual([
      '-XX:AOTMode=record',
      `-XX:AOTConfiguration=${output}.aotconf`,
    ])
    expect(engine.token).toMatch(/^[0-9a-f]{64}$/)
    const java = JSON.parse(await fs.readFile(javaRecordFile(), 'utf8')) as { args: string[] }
    expect(java.args).toEqual([
      '-Dfrom.file=1',
      '-Dinherited=1',
      '-XX:AOTMode=create',
      `-XX:AOTConfiguration=${output}.aotconf`,
      `-XX:AOTCache=${output}.tmp`,
      '--module-path',
      path.join(bundle, 'enso', 'dist', '1.0', 'component'),
      '-m',
      'org.enso.runner/org.enso.runner.Main',
    ])
  },
)

test('an abort during the drive kills the engine and leaves no files', async () => {
  vi.stubEnv('FAKE_NEVER_COMPLETE', '1')
  const output = path.join(root, 'key', 'enso.aot')
  const controller = new AbortController()
  const training = (await trainer()).train(output, controller.signal)
  await vi.waitFor(async () => expect(await exists(recordFile())).toBe(true), {
    timeout: 15_000,
  })
  const { pid } = await recorded()
  // Let the drive start.
  await new Promise((resolve) => setTimeout(resolve, 500))
  controller.abort()
  await expect(training).rejects.toMatchObject({ name: 'AbortError' })
  await vi.waitFor(() => expect(isAlive(pid)).toBe(false), { timeout: 10_000 })
  expect(await exists(output)).toBe(false)
  expect(await exists(`${output}.tmp`)).toBe(false)
  expect(await exists(path.join(root, 'scratch'))).toBe(false)
})

test(
  'an engine that exits 1 fails the training and leaves no cache',
  { timeout: 30_000 },
  async () => {
    vi.stubEnv('FAKE_EXIT_CODE', '1')
    const output = path.join(root, 'key', 'enso.aot')
    await expect((await trainer()).train(output, new AbortController().signal)).rejects.toThrow(
      /exited with 1/,
    )
    expect(await exists(output)).toBe(false)
    expect(await exists(`${output}.tmp`)).toBe(false)
    expect(await exists(javaRecordFile())).toBe(false)
  },
)
