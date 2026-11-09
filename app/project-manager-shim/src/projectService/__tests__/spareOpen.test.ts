/**
 * @file An open takes a spare whose key matches and writes it the line; a key that differs means an
 * ordinary spawn; a crash after the take respawns an ordinary engine. The engine is
 * `fakeSpareEngine.ts`. Through the service, an open with the spare's settings takes it.
 */
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createProject } from '../../localMetadata/__tests__/testUtils.js'
import {
  EnsoRunner,
  type EngineLaunch,
  type EngineLogSink,
  type StartupClock,
} from '../ensoRunner.js'
import { ProjectService } from '../index.js'
import { SPARE_WARM_UP_LIMIT_MS } from '../spareEngine.js'
import { ENGINE_TIMEOUTS } from '../timeouts.js'
import { Path, UUID } from '../types.js'
import { fakeSpareEnso, isAlive, spareEvents } from './fakeSpareEngine.js'
import { SPARE_OPEN_PORT } from './testPorts.js'

let root: string
let log: string
let runner: EnsoRunner

const exists = (file: string) =>
  fs.access(file).then(
    () => true,
    () => false,
  )

const jvm = (spareKey?: string): EngineLaunch => ({
  mode: { mode: 'jvm', source: 'option' },
  timeouts: { ...ENGINE_TIMEOUTS.jvm, ydocWaitMs: 0 },
  ...(spareKey != null ? { spareKey } : {}),
})

function sink(): EngineLogSink & { notices: string[]; stderr: string[] } {
  const notices: string[] = []
  const stderr: string[] = []
  return {
    notices,
    stderr,
    engineStarted: () => {},
    engineStderr: (chunk) => void stderr.push(chunk.toString()),
    projectClosed: () => {},
    notice: (text) => void notices.push(text),
  }
}

function startSpare(key: string) {
  runner.startSpare({
    key,
    extraArgs: ['--log-level', 'info'],
    extraEnv: [['ENSO_SECRETS_KEY', 'secret']],
    launch: jvm(),
  })
}

async function readySpare(key: string) {
  startSpare(key)
  await vi.waitFor(() => expect(runner.spareState).toBe('ready'), {
    timeout: 10_000,
  })
}

/** The real clock, recording the delay of every startup timeout the runner schedules. */
function recordingClock(): StartupClock & { startupTimeouts: number[] } {
  const startupTimeouts: number[] = []
  return {
    startupTimeouts,
    now: () => Date.now(),
    schedule: (timer, callback, delayMs) => {
      if (timer === 'startupTimeout') startupTimeouts.push(delayMs)
      setTimeout(callback, delayMs)
    },
  }
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'spare-open-'))
  log = path.join(root, 'spare.log')
  vi.stubEnv('SPARE_LOG', log)
  runner = new EnsoRunner(await fakeSpareEnso(root), {
    firstPort: SPARE_OPEN_PORT,
  })
})

afterEach(async () => {
  await runner.stopSpare('test over')
  vi.unstubAllEnvs()
  await fs.rm(root, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  })
})

test('an open takes a matching spare and writes it the line', async () => {
  await readySpare('k1')
  const project = path.join(root, 'P')
  const logSink = sink()
  const sockets = await runner.openProject(
    Path(project),
    'id-p',
    ['--log-level', 'info', '--vm.D', 'enso.Sql.Logger.level=debug'],
    [
      ['ENSO_LOCAL_PROJECT_ID', 'key-1'],
      ['ENSO_LOCAL_PROJECT_SESSION_ID', 'session-1'],
      ['ENSO_SECRETS_KEY', 'secret'],
    ],
    logSink,
    jvm('k1'),
  )
  expect(await exists(`${project}.spawned.json`)).toBe(false)
  const line = JSON.parse(await fs.readFile(`${project}.line.json`, 'utf8'))
  expect(line.spawnArgs).toEqual(['--jvm', '--standby', '--log-level', 'info'])
  // The engine refuses a line with `--jvm` (`StandbyRequest`): the spare already runs on the JVM.
  expect(line.args[0]).toBe('--server')
  expect(line.args).not.toContain('--jvm')
  expect(line.args).toContain('--vm.D')
  expect(line.args[line.args.indexOf('--rpc-port') + 1]).toBe(String(sockets.jsonSocket.port))
  expect(Object.keys(line.env).sort()).toEqual([
    'ENSO_LOCAL_PROJECT_ID',
    'ENSO_LOCAL_PROJECT_SESSION_ID',
    'LANGUAGE_SERVER_CHANNEL_TOKEN',
    'LANGUAGE_SERVER_YDOC_PORT',
  ])
  expect(line.env.LANGUAGE_SERVER_CHANNEL_TOKEN).toMatch(/^[0-9a-f]{64}$/)
  expect(line.env.ENSO_LOCAL_PROJECT_ID).toBe('key-1')
  expect(line.env.ENSO_LOCAL_PROJECT_SESSION_ID).toBe('session-1')
  expect(line.env.LANGUAGE_SERVER_YDOC_PORT).toBe(String(sockets.ydocSocket.port))
  expect(logSink.notices).toEqual([expect.stringMatching(/^Engine: pre-started spare used/)])
  expect(runner.spareState).toBe('none')
  await runner.closeProject(Path(project))
})

test("the spare's spawn environment never carries the line's variables", async () => {
  vi.stubEnv('LANGUAGE_SERVER_CHANNEL_TOKEN', 'inherited')
  vi.stubEnv('LANGUAGE_SERVER_YDOC_PORT', '1')
  vi.stubEnv('ENSO_LOCAL_PROJECT_ID', 'inherited')
  await readySpare('k1')
  const [start] = await spareEvents(log)
  expect(start?.env).toEqual({
    LANGUAGE_SERVER_CHANNEL_TOKEN: null,
    LANGUAGE_SERVER_YDOC_PORT: null,
    ENSO_LOCAL_PROJECT_ID: null,
    ENSO_SECRETS_KEY: 'secret',
  })
})

test("the taken spare's stderr reaches the open's log", async () => {
  await readySpare('k1')
  const project = path.join(root, 'E')
  const logSink = sink()
  await runner.openProject(Path(project), 'id-e', undefined, undefined, logSink, jvm('k1'))
  await vi.waitFor(() => expect(logSink.stderr.join('')).toContain('fake engine: line taken'))
  await runner.closeProject(Path(project))
})

test('a spare taken while warming up gives its open the warm-up limit on top of the startup limit', async () => {
  vi.stubEnv('READY_DELAY_MS', '60000')
  const clock = recordingClock()
  runner = new EnsoRunner(await fakeSpareEnso(root), {
    firstPort: SPARE_OPEN_PORT,
    startupClock: clock,
  })
  startSpare('k1')
  expect(runner.spareState).toBe('warming')
  const project = path.join(root, 'W')
  const logSink = sink()
  await runner.openProject(Path(project), 'id-w', undefined, undefined, logSink, jvm('k1'))
  expect(logSink.notices).toEqual([expect.stringMatching(/still warming up\)$/)])
  expect(clock.startupTimeouts).toEqual([ENGINE_TIMEOUTS.jvm.startupMs + SPARE_WARM_UP_LIMIT_MS])
  await runner.closeProject(Path(project))
})

test('a ready spare and its respawn get the plain startup limit', async () => {
  const clock = recordingClock()
  runner = new EnsoRunner(await fakeSpareEnso(root), {
    firstPort: SPARE_OPEN_PORT,
    startupClock: clock,
  })
  await readySpare('k1')
  const project = path.join(root, 'T')
  await runner.openProject(Path(project), 'id-t', undefined, undefined, undefined, jvm('k1'))
  const { pid } = JSON.parse(await fs.readFile(`${project}.line.json`, 'utf8'))
  process.kill(pid, 'SIGKILL')
  await vi.waitFor(() => expect(clock.startupTimeouts).toHaveLength(2), { timeout: 20_000 })
  expect(clock.startupTimeouts).toEqual([
    ENGINE_TIMEOUTS.jvm.startupMs,
    ENGINE_TIMEOUTS.jvm.startupMs,
  ])
  await runner.closeProject(Path(project))
}, 30_000)

test('a spare with another key is stopped and the open spawns as today', async () => {
  await readySpare('k1')
  const pid = runner.sparePid!
  const project = path.join(root, 'Q')
  const logSink = sink()
  await runner.openProject(Path(project), 'id-q', undefined, undefined, logSink, jvm('k2'))
  expect(await exists(`${project}.spawned.json`)).toBe(true)
  expect(logSink.notices).toEqual([
    'Engine: no pre-started spare (the spare was started with other settings)',
  ])
  await vi.waitFor(() => expect(isAlive(pid)).toBe(false), { timeout: 10_000 })
  await runner.closeProject(Path(project))
})

test('an open without a key leaves the spare alone and says nothing about it', async () => {
  await readySpare('k1')
  const project = path.join(root, 'N')
  const logSink = sink()
  await runner.openProject(Path(project), 'id-n', undefined, undefined, logSink, jvm())
  expect(await exists(`${project}.spawned.json`)).toBe(true)
  expect(logSink.notices).toEqual([])
  expect(runner.spareState).toBe('ready')
  await runner.closeProject(Path(project))
})

test('a crash after the take respawns an ordinary engine', async () => {
  await readySpare('k1')
  const project = path.join(root, 'R')
  await runner.openProject(Path(project), 'id-r', undefined, undefined, undefined, jvm('k1'))
  const { pid } = JSON.parse(await fs.readFile(`${project}.line.json`, 'utf8'))
  process.kill(pid, 'SIGKILL')
  await vi.waitFor(async () => expect(await exists(`${project}.spawned.json`)).toBe(true), {
    timeout: 20_000,
  })
  expect((await spareEvents(log)).filter((e) => e.event === 'start')).toHaveLength(1)
  await runner.closeProject(Path(project))
}, 30_000)

test('a spare that fails after the take gives way to an ordinary engine', async () => {
  vi.stubEnv('SPARE_REFUSES_LINE', '1')
  await readySpare('k1')
  const project = path.join(root, 'F')
  const logSink = sink()
  await runner.openProject(Path(project), 'id-f', undefined, undefined, logSink, jvm('k1'))
  expect(await exists(`${project}.spawned.json`)).toBe(true)
  expect(logSink.notices).toEqual([
    expect.stringMatching(/^Engine: pre-started spare used/),
    'Engine: the pre-started spare failed to start; starting a new one',
  ])
  await runner.closeProject(Path(project))
})

test('a closing project is no longer in use', async () => {
  const project = path.join(root, 'C')
  const release = path.join(root, 'release-exit')
  // The engine does not exit on its stdin line until this file exists.
  vi.stubEnv('EXIT_AFTER_FILE', release)
  await runner.openProject(Path(project), 'id-c', undefined, undefined, undefined, jvm())
  expect(await runner.hasProjectsInUse()).toBe(true)
  const closing = runner.closeProject(Path(project))
  await vi.waitFor(async () => expect(await runner.hasProjectsInUse()).toBe(false))
  expect(await runner.hasRunningProjects()).toBe(true)
  await fs.writeFile(release, '')
  await closing
  expect(await runner.hasRunningProjects()).toBe(false)
})

describe('through the service', () => {
  let secretsKey: string
  let hosted: EnsoRunner
  let service: ProjectService

  beforeEach(async () => {
    vi.stubEnv('ENSO_LOG_DIRECTORY', path.join(root, 'logs'))
    vi.stubEnv('ENSO_SPARE_ENGINE', '')
    vi.stubEnv('ENSO_YDOC_HOST', '')
    vi.stubEnv('ENSO_ENGINE_MODE', '')
    secretsKey = 'key-a'
    // A ydoc host that only says yes: the open then waits for no ydoc port the fake lacks.
    hosted = new EnsoRunner(await fakeSpareEnso(root), {
      firstPort: SPARE_OPEN_PORT,
      ydocHost: { listen: async () => {}, close: async () => {} },
    })
    const quiet: Console = { ...console, debug: () => {} }
    service = new ProjectService(
      hosted,
      ['--log-level', 'info'],
      quiet,
      undefined,
      undefined,
      () => [['ENSO_SECRETS_KEY', secretsKey]],
      { option: 'jvm' },
    )
    await createProject(path.join(root, 'S'), 'id-s')
  })

  afterEach(async () => {
    await service.stopSpareEngine()
    await hosted.stopSpare('test over')
  })

  test('an open with the settings the spare was started with takes it; a changed setting does not', async () => {
    const project = path.join(root, 'S')
    await service.setSpareEngine(true)
    await vi.waitFor(() => expect(hosted.spareState).toBe('ready'), { timeout: 10_000 })
    expect((await spareEvents(log))[0]?.env?.ENSO_SECRETS_KEY).toBe('key-a')
    // With engine logging of its own, which travels in the line.
    await service.openProject(UUID('id-s'), Path(root), { sqlQueries: true })
    expect(await exists(`${project}.spawned.json`)).toBe(false)
    const line = JSON.parse(await fs.readFile(`${project}.line.json`, 'utf8'))
    expect(line.args).toContain('--vm.D')
    await service.closeProject(UUID('id-s'), Path(root))

    // The close starts the next spare; the key changes before any refresh has seen it.
    await vi.waitFor(() => expect(hosted.spareState).toBe('ready'), { timeout: 10_000 })
    secretsKey = 'key-b'
    await service.openProject(UUID('id-s'), Path(root))
    expect(await exists(`${project}.spawned.json`)).toBe(true)
    await service.closeProject(UUID('id-s'), Path(root))
  }, 30_000)
})
