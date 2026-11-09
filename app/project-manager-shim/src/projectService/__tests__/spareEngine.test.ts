/** @file `SpareEngine` with a fake `enso`: start, ready, take, stop, failure, and the line. */
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  SpareEngine,
  spareNotice,
  spawnKey,
  standbyLine,
  type SpareEngineOptions,
  type SpareSpawn,
} from '../spareEngine.js'
import { fakeSpareEnso, isAlive, spareEvents } from './fakeSpareEngine.js'

let root: string
let log: string
const engines: SpareEngine[] = []

async function spawnOf(key: string, env: Record<string, string> = {}): Promise<SpareSpawn> {
  const launcher = await fakeSpareEnso(root)
  const args = ['--jvm', '--standby', '--log-level', 'info']
  const [command, commandArgs] =
    launcher.endsWith('.bat') ? ['cmd.exe', ['/c', launcher, ...args]] : [launcher, args]
  return { key, command, args: commandArgs, env: { ...process.env, SPARE_LOG: log, ...env } }
}

function spare(options: SpareEngineOptions = {}): SpareEngine {
  const created = new SpareEngine({ log: () => {}, ...options })
  engines.push(created)
  return created
}

/**
 * The pid of the fake engine that logged the `count`th `start`: the engine itself, which on Windows
 * is a child of the `cmd.exe` whose pid `SpareEngine.pid` reports.
 */
async function fakePid(count: number): Promise<number> {
  return vi.waitFor(
    async () => {
      const starts = (await spareEvents(log)).filter((e) => e.event === 'start')
      expect(starts).toHaveLength(count)
      return starts[count - 1]!.pid
    },
    { timeout: 10_000 },
  )
}

/** Wait until the fake engine `pid` has logged `stdin-closed` and is gone. */
async function closedByStdin(pid: number): Promise<void> {
  await vi.waitFor(
    async () => {
      const events = await spareEvents(log)
      expect(events.some((e) => e.event === 'stdin-closed' && e.pid === pid)).toBe(true)
      expect(isAlive(pid)).toBe(false)
    },
    { timeout: 10_000 },
  )
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'spare-engine-'))
  log = path.join(root, 'spare.log')
})

afterEach(async () => {
  for (const created of engines.splice(0)) created.stop('test over')
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

test('the key is stable, and changes with any input', () => {
  const inputs = {
    mode: 'jvm' as const,
    args: ['--log-level', 'info'],
    jvmOptions: [],
    env: { A: '1', B: '2' },
  }
  expect(spawnKey(inputs)).toMatch(/^[0-9a-f]{64}$/)
  expect(spawnKey({ ...inputs, env: { B: '2', A: '1' } })).toBe(spawnKey(inputs))
  expect(spawnKey({ ...inputs, args: ['--log-level', 'trace'] })).not.toBe(spawnKey(inputs))
  expect(spawnKey({ ...inputs, jvmOptions: ['-XX:AOTCache=a'] })).not.toBe(spawnKey(inputs))
  expect(spawnKey({ ...inputs, env: { A: '1', B: '3' } })).not.toBe(spawnKey(inputs))
})

test('the line is one line of JSON', () => {
  const line = standbyLine(['--path', 'C:\\A "B"'], { ENSO_LOCAL_PROJECT_ID: 'k' })
  expect(line.endsWith('\n')).toBe(true)
  expect(line.slice(0, -1)).not.toContain('\n')
  expect(JSON.parse(line)).toEqual({
    args: ['--path', 'C:\\A "B"'],
    env: { ENSO_LOCAL_PROJECT_ID: 'k' },
  })
})

test('a spare starts in the temporary directory, warms up, and is taken by its key', async () => {
  const engine = spare()
  engine.start(await spawnOf('k1'))
  expect(engine.state).toBe('warming')
  await vi.waitFor(() => expect(engine.state).toBe('ready'), { timeout: 10_000 })
  const [start] = await spareEvents(log)
  expect(start?.args).toEqual(['--jvm', '--standby', '--log-level', 'info'])
  expect(await fs.realpath(start!.cwd!)).toBe(await fs.realpath(os.tmpdir()))
  const result = engine.take('k1')
  expect(result.kind).toBe('taken')
  expect(engine.state).toBe('none')
  if (result.kind === 'taken') {
    expect(result.spare.readyAfterMs).toBeGreaterThanOrEqual(0)
    expect(spareNotice(result, result.spare.startedAt + 3000)).toMatch(/pre-started spare used/)
    result.spare.child.stdin?.end()
  }
}, 30_000)

test('a spare still warming up is taken as it is', async () => {
  const engine = spare()
  engine.start(await spawnOf('k1', { READY_DELAY_MS: '60000' }))
  const pid = await fakePid(1)
  const result = engine.take('k1')
  expect(result.kind).toBe('taken')
  if (result.kind === 'taken') {
    expect(result.spare.readyAfterMs).toBeUndefined()
    expect(spareNotice(result, result.spare.startedAt + 1500)).toBe(
      'Engine: pre-started spare used (started 1.5 s before the open, still warming up)',
    )
    result.spare.child.stderr?.resume()
    result.spare.child.stdin?.end()
  }
  await closedByStdin(pid)
}, 30_000)

test('the ready line is found when it arrives in two chunks, and only once complete', async () => {
  const lines: string[] = []
  const engine = spare({ log: (line) => lines.push(line) })
  engine.start(await spawnOf('k1', { READY_SPLIT: '1' }))
  await vi.waitFor(() => expect(engine.state).toBe('ready'), { timeout: 10_000 })
  const ready = lines.filter((line) => line.startsWith('ready after '))
  expect(ready).toHaveLength(1)
  expect(ready[0]).toMatch(/\(42 ms from its own start\)$/)
}, 30_000)

test('a spare with another key is stopped, not taken', async () => {
  const engine = spare()
  engine.start(await spawnOf('k1'))
  await vi.waitFor(() => expect(engine.state).toBe('ready'), { timeout: 10_000 })
  const pid = await fakePid(1)
  const result = engine.take('k2')
  expect(result).toEqual({ kind: 'none', reason: 'the spare was started with other settings' })
  expect(spareNotice(result, Date.now())).toBe(
    'Engine: no pre-started spare (the spare was started with other settings)',
  )
  expect(engine.state).toBe('none')
  await closedByStdin(pid)
}, 30_000)

test('starting again with the same key keeps the running spare; a new key replaces it', async () => {
  const engine = spare()
  engine.start(await spawnOf('k1'))
  const first = engine.pid!
  engine.start(await spawnOf('k1'))
  expect(engine.pid).toBe(first)
  // Replaced before its process ran, the first spare would log no start at all.
  const firstFake = await fakePid(1)
  engine.start(await spawnOf('k2'))
  expect(engine.pid).not.toBe(first)
  expect(engine.state).toBe('warming')
  await fakePid(2)
  await closedByStdin(firstFake)
}, 30_000)

test('a spare that dies is dropped, and its key is not started again until the failure is cleared', async () => {
  const engine = spare()
  engine.start(await spawnOf('k1', { SPARE_DIES: '1' }))
  await vi.waitFor(() => expect(engine.state).toBe('none'), { timeout: 10_000 })
  expect(engine.take('k1')).toEqual({ kind: 'none', reason: 'the last spare failed' })
  engine.start(await spawnOf('k1', { SPARE_DIES: '1' }))
  expect(engine.state).toBe('none')
  expect((await spareEvents(log)).filter((e) => e.event === 'start')).toHaveLength(1)
  // Another key starts, and does not clear the first one's failure.
  engine.start(await spawnOf('k2'))
  expect(engine.state).toBe('warming')
  expect(engine.take('k1').kind).toBe('none')
  engine.start(await spawnOf('k1'))
  expect(engine.state).toBe('none')
  engine.clearFailure()
  engine.start(await spawnOf('k1'))
  expect(engine.state).toBe('warming')
}, 30_000)

test('a spare that has exited is not taken', async () => {
  const engine = spare()
  engine.start(await spawnOf('k1'))
  await vi.waitFor(() => expect(engine.state).toBe('ready'), { timeout: 10_000 })
  process.kill(await fakePid(1))
  await vi.waitFor(() => expect(engine.state).toBe('none'), { timeout: 10_000 })
  expect(engine.take('k1')).toEqual({ kind: 'none', reason: 'the last spare failed' })
}, 30_000)

test('an executable that cannot be started is a failure, reported after spawn returns', async () => {
  const engine = spare()
  const missing = { ...(await spawnOf('k1')), command: path.join(root, 'no-such-enso'), args: [] }
  engine.start(missing)
  await vi.waitFor(() => expect(engine.state).toBe('none'), { timeout: 10_000 })
  expect(engine.take('k1')).toEqual({ kind: 'none', reason: 'the last spare failed' })
  engine.start(missing)
  expect(engine.state).toBe('none')
}, 30_000)

test('stop closes the spare', async () => {
  const engine = spare()
  engine.start(await spawnOf('k1'))
  await vi.waitFor(() => expect(engine.state).toBe('ready'), { timeout: 10_000 })
  const pid = await fakePid(1)
  engine.stop('quitting')
  expect(engine.state).toBe('none')
  await closedByStdin(pid)
}, 30_000)

test('a stopped spare that does not exit is killed after the grace period, with its children', async () => {
  const engine = spare({ stopGraceMs: 300 })
  engine.start(await spawnOf('k1', { SPARE_IGNORES_STDIN: '1' }))
  await vi.waitFor(() => expect(engine.state).toBe('ready'), { timeout: 10_000 })
  const launcher = engine.pid!
  const pid = await fakePid(1)
  engine.stop('quitting')
  await vi.waitFor(
    () => {
      expect(isAlive(pid)).toBe(false)
      expect(isAlive(launcher)).toBe(false)
    },
    { timeout: 10_000 },
  )
  expect((await spareEvents(log)).some((e) => e.event === 'stdin-closed')).toBe(false)
}, 30_000)
