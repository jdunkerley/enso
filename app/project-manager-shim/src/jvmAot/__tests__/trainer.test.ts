/**
 * @file The trainer with a fake `enso`: a Node script that makes the scratch project for `--new`,
 * and for `--server` serves the fake Language Server and, on the stdin newline, writes the file
 * named by `-XX:AOTCacheOutput=` and exits.
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
const args = process.argv.slice(2)
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
  jvmOptions: process.env.ENSO_JVM_OPTIONS ?? null,
  token: process.env.LANGUAGE_SERVER_CHANNEL_TOKEN ?? null,
  ydocPort: process.env.LANGUAGE_SERVER_YDOC_PORT ?? null,
}))
const { startFakeLanguageServer } = await import(${JSON.stringify(FAKE_LS)})
const never = process.env.FAKE_NEVER_COMPLETE === '1'
await startFakeLanguageServer({
  token: process.env.LANGUAGE_SERVER_CHANNEL_TOKEN,
  port: Number(value('--rpc-port')),
  completeAfterMs: never ? null : 100,
})
process.stdin.on('data', () => {
  const output = process.env.ENSO_JVM_OPTIONS.split(/\\r?\\n/)
    .find((o) => o.startsWith('-XX:AOTCacheOutput='))
    .slice('-XX:AOTCacheOutput='.length)
  const code = Number(process.env.FAKE_EXIT_CODE ?? '0')
  if (code === 0) fs.writeFileSync(output, 'cache')
  process.exit(code)
})
`

let root: string

async function fakeEnso(directory: string): Promise<string> {
  const script = path.join(directory, 'fake-enso.mjs')
  await fs.writeFile(script, FAKE_ENSO)
  if (process.platform === 'win32') {
    const launcher = path.join(directory, 'enso.bat')
    await fs.writeFile(launcher, `@"${process.execPath}" "${script}" %*\r\n`)
    return launcher
  }
  const launcher = path.join(directory, 'enso')
  await fs.writeFile(launcher, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`)
  await fs.chmod(launcher, 0o755)
  return launcher
}

interface Recorded {
  args: string[]
  pid: number
  jvmOptions: string | null
  token: string | null
  ydocPort: string | null
}

const recordFile = () => path.join(root, 'record.json')
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
  return new EngineTrainer({
    ensoExecutable: await fakeEnso(root),
    scratchRoot: path.join(root, 'scratch'),
    firstPort: JVM_AOT_TRAINER_PORT,
    startupTimeoutMs: 20_000,
    driveTimeoutMs: 20_000,
    exitTimeoutMs: 20_000,
  })
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'aot-trainer-'))
  vi.stubEnv('FAKE_RECORD', recordFile())
  vi.stubEnv('LANGUAGE_SERVER_YDOC_PORT', '1234')
  vi.stubEnv('ENSO_JVM_OPTIONS', '')
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

test('a training writes the cache and removes the scratch directory', async () => {
  const output = path.join(root, 'key dir', 'enso.aot')
  await (await trainer()).train(output, new AbortController().signal)
  expect(await fs.readFile(output, 'utf8')).toBe('cache')
  expect(await exists(`${output}.tmp`)).toBe(false)
  expect(await exists(path.join(root, 'scratch'))).toBe(false)
})

test('the engine gets --jvm, the output option, a token and no ydoc port', async () => {
  const output = path.join(root, 'key dir', 'enso.aot')
  await (await trainer()).train(output, new AbortController().signal)
  const engine = await recorded()
  expect(engine.args.slice(0, 2)).toEqual(['--jvm', '--server'])
  expect(engine.args[engine.args.indexOf('--path') + 1]).toBe(path.join(root, 'scratch', 'Train'))
  expect(engine.jvmOptions).toBe(`-XX:AOTCacheOutput=${output}.tmp\n`)
  expect(engine.token).toMatch(/^[0-9a-f]{64}$/)
  expect(engine.ydocPort).toBeNull()
})

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

test('an engine that exits 1 fails the training and leaves no cache', async () => {
  vi.stubEnv('FAKE_EXIT_CODE', '1')
  const output = path.join(root, 'key', 'enso.aot')
  await expect((await trainer()).train(output, new AbortController().signal)).rejects.toThrow(
    /exited with 1/,
  )
  expect(await exists(output)).toBe(false)
  expect(await exists(`${output}.tmp`)).toBe(false)
})
