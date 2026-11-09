/** @file `SpareEngine` with a fake `enso`: start, ready, take, stop, failure, and the line. */
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { SpareEngine, spareNotice, spawnKey, standbyLine, type SpareSpawn } from '../spareEngine.js'
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

function spare(): SpareEngine {
  const created = new SpareEngine({ log: () => {} })
  engines.push(created)
  return created
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

test('a spare with another key is stopped, not taken', async () => {
  const engine = spare()
  engine.start(await spawnOf('k1'))
  await vi.waitFor(() => expect(engine.state).toBe('ready'), { timeout: 10_000 })
  const pid = engine.pid!
  const result = engine.take('k2')
  expect(result).toEqual({ kind: 'none', reason: 'the spare was started with other settings' })
  expect(spareNotice(result, Date.now())).toBe(
    'Engine: no pre-started spare (the spare was started with other settings)',
  )
  await vi.waitFor(
    async () => {
      const closed = (await spareEvents(log)).some((e) => e.event === 'stdin-closed')
      expect(closed || !isAlive(pid)).toBe(true)
    },
    { timeout: 10_000 },
  )
  expect(engine.state).toBe('none')
}, 30_000)

test('starting again with the same key keeps the running spare; a new key replaces it', async () => {
  const engine = spare()
  engine.start(await spawnOf('k1'))
  const first = engine.pid!
  engine.start(await spawnOf('k1'))
  expect(engine.pid).toBe(first)
  const starts = async () => (await spareEvents(log)).filter((e) => e.event === 'start')
  // Replaced before its process ran, the first spare would log no start at all.
  await vi.waitFor(async () => expect(await starts()).toHaveLength(1), { timeout: 10_000 })
  engine.start(await spawnOf('k2'))
  expect(engine.pid).not.toBe(first)
  expect(engine.state).toBe('warming')
  await vi.waitFor(async () => expect(await starts()).toHaveLength(2), { timeout: 10_000 })
  await vi.waitFor(() => expect(isAlive(first)).toBe(false), { timeout: 10_000 })
}, 30_000)

test('a spare that dies is dropped and not started again until the failure is cleared', async () => {
  const engine = spare()
  engine.start(await spawnOf('k1', { SPARE_DIES: '1' }))
  await vi.waitFor(() => expect(engine.state).toBe('none'), { timeout: 10_000 })
  expect(engine.take('k1')).toEqual({ kind: 'none', reason: 'the last spare failed' })
  engine.start(await spawnOf('k1', { SPARE_DIES: '1' }))
  expect(engine.state).toBe('none')
  expect((await spareEvents(log)).filter((e) => e.event === 'start')).toHaveLength(1)
  engine.clearFailure()
  engine.start(await spawnOf('k1'))
  expect(engine.state).toBe('warming')
}, 30_000)

test('stop closes the spare', async () => {
  const engine = spare()
  engine.start(await spawnOf('k1'))
  await vi.waitFor(() => expect(engine.state).toBe('ready'), { timeout: 10_000 })
  const pid = engine.pid!
  engine.stop('quitting')
  expect(engine.state).toBe('none')
  await vi.waitFor(() => expect(isAlive(pid)).toBe(false), { timeout: 10_000 })
}, 30_000)
