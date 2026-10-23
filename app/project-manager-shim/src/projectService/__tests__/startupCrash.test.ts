/**
 * @file An engine that never passes its first health check fails `openProject`, and leaves nothing
 * behind: no respawned engine, no health check still polling its port, no unhandled rejection, and
 * no failure for another open. The engine is a fake `enso`, a Node script that counts its starts
 * and records its port, and acts on its project's name: `Crash` exits with code 1 at once, as an
 * engine whose port was taken does; `Hang` never listens, and exits by itself after a while; any
 * other answers the health check until a newline on its stdin.
 */
import * as fs from 'node:fs/promises'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { EnsoRunner } from '../ensoRunner.js'
import { Path } from '../types.js'
import { STARTUP_CRASH_PORT } from './testPorts.js'

/**
 * The startup timeout of every engine whose startup is not the subject of a test. It must be far
 * beyond the time a loaded machine needs to start a Node process (a `.bat` launching Node, on
 * Windows): the clock starts at the spawn, so a short one fails a healthy open, or an engine that
 * is about to exit, with a timeout instead.
 */
const STARTUP_TIMEOUT_MS = 30_000
/** The startup timeout of the `Hang` engine, the subject of its test. */
const HANG_STARTUP_TIMEOUT_MS = 2_000
/** How long a `Hang` engine lives: past the startup timeout, so it is killed first. */
const HANG_EXIT_MS = 6_000
/** Several load health-check intervals (250 ms each). */
const LINGER_MS = 1_500

const FAKE_ENSO = `
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as path from 'node:path'
const args = process.argv.slice(2)
const value = (flag) => args[args.indexOf(flag) + 1]
const project = value('--path')
const port = Number(value('--rpc-port'))
const startsFile = project + '.starts'
const starts = (fs.existsSync(startsFile) ? Number(fs.readFileSync(startsFile, 'utf8')) : 0) + 1
fs.writeFileSync(startsFile, String(starts))
fs.writeFileSync(project + '.port', String(port))
const mode = path.basename(project)
if (mode === 'Crash') {
  process.exit(1)
} else if (mode === 'Hang') {
  setTimeout(() => process.exit(0), ${HANG_EXIT_MS})
} else {
  http.createServer((_request, response) => response.end('ok')).listen(port, '127.0.0.1')
  const stop = () => process.exit(0)
  process.stdin.on('data', stop)
  process.stdin.on('end', stop)
}
`

let root: string
let runner: EnsoRunner
let unhandled: unknown[]
const onUnhandled = (reason: unknown) => void unhandled.push(reason)

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

const launcherName = () => (process.platform === 'win32' ? 'enso.bat' : 'enso')

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Serve the port the failed engine was given for {@link LINGER_MS}, as a later engine would, and
 * count the requests: a health check still polling for the failed open would reach it.
 */
async function requestsToPortAfterwards(project: Path): Promise<number> {
  // An engine killed before Node ran its script wrote no port: it got the first one.
  const port = Number(await fs.readFile(`${project}.port`, 'utf8').catch(() => STARTUP_CRASH_PORT))
  let requests = 0
  const server = http.createServer((_request, response) => {
    requests += 1
    response.end('ok')
  })
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
  try {
    await sleep(LINGER_MS)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
  return requests
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'startup-crash-'))
  runner = new EnsoRunner(await fakeEnso(root), {
    firstPort: STARTUP_CRASH_PORT,
    startupTimeoutMs: STARTUP_TIMEOUT_MS,
  })
  unhandled = []
  process.on('unhandledRejection', onUnhandled)
})

afterEach(async () => {
  process.off('unhandledRejection', onUnhandled)
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

test('an engine that exits while loading fails the open and leaves nothing behind', async () => {
  const project = Path(path.join(root, 'Crash'))
  await expect(runner.openProject(project, 'id')).rejects.toThrow('exited with code=1')
  expect(await requestsToPortAfterwards(project)).toBe(0)
  expect(await fs.readFile(`${project}.starts`, 'utf8')).toBe('1')
  expect(await runner.hasRunningProjects()).toBe(false)
  expect(unhandled).toEqual([])
}, 30_000)

test('an engine that does not start in time fails the open and leaves nothing behind', async () => {
  const project = Path(path.join(root, 'Hang'))
  runner = new EnsoRunner(Path(path.join(root, launcherName())), {
    firstPort: STARTUP_CRASH_PORT,
    startupTimeoutMs: HANG_STARTUP_TIMEOUT_MS,
  })
  await expect(runner.openProject(project, 'id')).rejects.toThrow('Language server startup timeout')
  expect(await requestsToPortAfterwards(project)).toBe(0)
  // Past the time the engine would have exited by itself, had it not been killed.
  await sleep(HANG_EXIT_MS)
  // Never more than one start (none, if the kill came before Node ran the script): no respawn.
  expect(Number(await fs.readFile(`${project}.starts`, 'utf8').catch(() => '0'))).toBeLessThan(2)
  expect(await runner.hasRunningProjects()).toBe(false)
  expect(unhandled).toEqual([])
}, 60_000)

test('a failed open fails neither an open nor a close waiting for it', async () => {
  const crash = Path(path.join(root, 'Crash'))
  const other = Path(path.join(root, 'Other'))
  const failing = runner.openProject(crash, 'crash')
  // Both wait for the first open to finish: the open before it looks for ports.
  const opening = runner.openProject(other, 'other')
  const closing = runner.closeProject(crash)
  await expect(failing).rejects.toThrow('exited with code=1')
  await expect(closing).resolves.toBeUndefined()
  await expect(opening).resolves.toBeDefined()
  await runner.closeProject(other)
  expect(await runner.hasRunningProjects()).toBe(false)
  expect(unhandled).toEqual([])
}, 30_000)
