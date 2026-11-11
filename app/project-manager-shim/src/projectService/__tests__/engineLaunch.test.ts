/**
 * @file An open and a run take their engine launch: `--jvm` for a JVM engine, `ENSO_JVM_OPTIONS`
 * for extra options, and the launch's timeouts in place of the runner's. The engine is a fake
 * `enso`, a Node script that records its arguments, answers the health check after `DELAY_MS` and
 * exits on a stdin newline after `EXIT_DELAY_MS`.
 */
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { EnsoRunner, type EngineLaunch } from '../ensoRunner.js'
import { ENGINE_TIMEOUTS, type EngineTimeouts } from '../timeouts.js'
import { Path } from '../types.js'
import { ENGINE_MODE_PORT } from './testPorts.js'

const FAKE_ENSO = `
import * as fs from 'node:fs'
import * as http from 'node:http'
const args = process.argv.slice(2)
const value = (flag) => args[args.indexOf(flag) + 1]
const target = (args.includes('--run') ? value('--run') : value('--path')) + '.args.json'
fs.writeFileSync(target, JSON.stringify({ args, jvmOptions: process.env.ENSO_JVM_OPTIONS ?? null }))
if (args.includes('--run')) process.exit(0)
setTimeout(() => {
  http.createServer((_q, r) => r.end('OK')).listen(Number(value('--rpc-port')), '127.0.0.1')
}, Number(process.env.DELAY_MS ?? '0'))
process.stdin.on('data', () => setTimeout(() => process.exit(0), Number(process.env.EXIT_DELAY_MS ?? '0')))
`

let root: string

/** Write the fake executable: a `.bat` on Windows (as the runner expects), a script elsewhere. */
async function fakeEnso(directory: string): Promise<Path> {
  const script = path.join(directory, 'fake-enso.mjs')
  await fs.writeFile(script, FAKE_ENSO)
  if (process.platform === 'win32') {
    const launcher = path.join(directory, 'enso.bat')
    await fs.writeFile(launcher, `@"${process.execPath}" "${script}" %*\r\n`)
    return Path(launcher)
  }
  const launcher = path.join(directory, 'enso')
  await fs.writeFile(launcher, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`)
  await fs.chmod(launcher, 0o755)
  return Path(launcher)
}

const recorded = async (project: string) =>
  JSON.parse(await fs.readFile(`${project}.args.json`, 'utf8')) as {
    args: string[]
    jvmOptions: string | null
  }

const jvm = (timeouts: Partial<EngineTimeouts> = {}): EngineLaunch => ({
  mode: { mode: 'jvm', source: 'environment' },
  timeouts: { ...ENGINE_TIMEOUTS.jvm, ...timeouts },
})

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'engine-launch-'))
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

test('a JVM launch passes --jvm first, and native passes nothing', async () => {
  const runner = new EnsoRunner(await fakeEnso(root), { firstPort: ENGINE_MODE_PORT })
  const a = path.join(root, 'A')
  await runner.openProject(Path(a), 'id-a', ['--log-level', 'info'], undefined, undefined, jvm())
  expect((await recorded(a)).args.slice(0, 2)).toEqual(['--jvm', '--server'])
  await runner.closeProject(Path(a))
  const b = path.join(root, 'B')
  await runner.openProject(Path(b), 'id-b', undefined, undefined, undefined, {
    mode: { mode: 'native', source: 'default' },
    timeouts: ENGINE_TIMEOUTS.native,
  })
  expect((await recorded(b)).args).not.toContain('--jvm')
  await runner.closeProject(Path(b))
})

test('--run takes the mode too', async () => {
  const runner = new EnsoRunner(await fakeEnso(root), { firstPort: ENGINE_MODE_PORT })
  const p = path.join(root, 'R')
  expect(await runner.runProject(Path(p), undefined, jvm())).toBe(0)
  expect((await recorded(p)).args.slice(0, 2)).toEqual(['--jvm', '--run'])
})

test('the JVM options reach ENSO_JVM_OPTIONS one per line, after an inherited value', async () => {
  vi.stubEnv('ENSO_JVM_OPTIONS', '-Dinherited=1')
  const runner = new EnsoRunner(await fakeEnso(root), { firstPort: ENGINE_MODE_PORT })
  const p = path.join(root, 'O')
  await runner.openProject(Path(p), 'id-o', undefined, undefined, undefined, {
    ...jvm(),
    jvmOptions: ['-XX:AOTCache=C:\\Users\\John Smith\\enso.aot', '-Dx=y'],
  })
  expect((await recorded(p)).jvmOptions).toBe(
    '-Dinherited=1\n-XX:AOTCache=C:\\Users\\John Smith\\enso.aot\n-Dx=y',
  )
  await runner.closeProject(Path(p))
})

test("a launch's startup timeout replaces the runner's", async () => {
  // The runner's own 1 s would kill an engine that passes its health check after 2 s.
  vi.stubEnv('DELAY_MS', '2000')
  const runner = new EnsoRunner(await fakeEnso(root), {
    firstPort: ENGINE_MODE_PORT,
    startupTimeoutMs: 1000,
  })
  const p = path.join(root, 'S')
  await expect(
    runner.openProject(
      Path(p),
      'id-s',
      undefined,
      undefined,
      undefined,
      jvm({ startupMs: 10_000 }),
    ),
  ).resolves.toBeDefined()
  await runner.closeProject(Path(p))
})

test("a launch's terminate timeout replaces the native default", async () => {
  vi.stubEnv('EXIT_DELAY_MS', '6000')
  const runner = new EnsoRunner(await fakeEnso(root), { firstPort: ENGINE_MODE_PORT })
  const p = path.join(root, 'T')
  await runner.openProject(
    Path(p),
    'id-t',
    undefined,
    undefined,
    undefined,
    jvm({ terminateMs: 500 }),
  )
  const started = Date.now()
  await runner.closeProject(Path(p))
  // Killed after 500 ms rather than waited for (6 s); the 1 s of slack is the drain wait of the Windows launcher.
  expect(Date.now() - started).toBeLessThan(3000)
})
