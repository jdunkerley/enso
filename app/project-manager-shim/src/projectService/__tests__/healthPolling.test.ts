/**
 * @file Start-up health polling and the wait for the ydoc port, against fake `enso` engines (Node
 * scripts). The schedule of the polls and the startup timeout are asserted through a test
 * `StartupClock` (Note [Start-Up Tests Read The Schedule]); the ydoc tests run on the real clock.
 */
import * as fs from 'node:fs'
import * as fsPromises from 'node:fs/promises'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { EnsoRunner, type StartupClock } from '../ensoRunner.js'
import { Path } from '../types.js'
import { fakeLauncherCommand } from './fakeLauncher.js'
import { HEALTH_POLLING_PORT } from './testPorts.js'

/* Note [Start-Up Tests Read The Schedule]
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
 * These tests used to measure real time: the gaps between the fake's requests, or a fake that turned
 * healthy 1 s after its own start racing a 1.7 s startup timeout. The fake is a separate Node
 * process, and on a loaded runner (the shim suite runs its files in parallel, some spawning dozens
 * of git processes) its start-up alone can take most of a second, so each of them failed now and
 * then in CI. The polling test now asserts the delays the runner asks its clock for, on a clock
 * whose time moves only by those delays; the timeout test fires the startup timeout itself, at the
 * one moment it is about (the health check passed, the ydoc wait running). Neither depends on how
 * fast anything runs. `loadHealthcheckDelay` itself is tested in `healthcheckDelay.test.ts`.
 */

/**
 * Answers `503` to `/_health` until the file `<project>.ready` exists, then `200`. It counts the
 * `503`s in `<project>.unhealthy`.
 */
const FAKE_ENSO = `
import * as fs from 'node:fs'
import * as http from 'node:http'
const args = process.argv.slice(2)
const value = (flag) => args[args.indexOf(flag) + 1]
const project = value('--path')
const port = Number(value('--rpc-port'))
let unhealthy = 0
http
  .createServer((_request, response) => {
    if (fs.existsSync(project + '.ready')) return response.end('ok')
    fs.writeFileSync(project + '.unhealthy', String(++unhealthy))
    response.statusCode = 503
    response.end('starting')
  })
  .listen(port, '127.0.0.1')
const stop = () => process.exit(0)
process.stdin.on('data', stop)
process.stdin.on('end', stop)
`

/**
 * Healthy at once, but the ydoc server (`LANGUAGE_SERVER_YDOC_PORT`) listens only after 400 ms,
 * as the real engine's does: the GraalJS server starts after the Language Server. A project named
 * `NoYdoc` never listens on it.
 */
const FAKE_ENSO_LATE_YDOC = `
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as net from 'node:net'
import * as path from 'node:path'
const args = process.argv.slice(2)
const value = (flag) => args[args.indexOf(flag) + 1]
const project = value('--path')
const name = path.basename(project)
const port = Number(value('--rpc-port'))
http.createServer((_request, response) => response.end('ok')).listen(port, '127.0.0.1')
// Otherwise the time at which it listens is written down, so that a test can compare it with the
// moment the open resolved.
if (name !== 'NoYdoc')
  setTimeout(() => {
    // Written before listen(): the kernel accepts a connection as soon as the socket listens, before
    // listen's callback runs, so a file written there could be read before it exists.
    fs.writeFileSync(project + '.listening', String(Date.now()))
    net.createServer().listen(Number(process.env.LANGUAGE_SERVER_YDOC_PORT), '127.0.0.1')
  }, 400)
const stop = () => process.exit(0)
process.stdin.on('data', stop)
process.stdin.on('end', stop)
`

let root: string

/** Write the fake executable: a `.bat` on Windows (as the runner expects), a script elsewhere. */
async function fakeEnso(directory: string, source: string = FAKE_ENSO): Promise<Path> {
  const script = path.join(directory, 'fake-enso.mjs')
  await fsPromises.writeFile(script, source)
  if (process.platform === 'win32') {
    const launcher = path.join(directory, 'enso.bat')
    await fsPromises.writeFile(launcher, `@"${process.execPath}" "${script}" %*\r\n`)
    return Path(launcher)
  }
  const launcher = path.join(directory, 'enso')
  await fsPromises.writeFile(launcher, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`)
  await fsPromises.chmod(launcher, 0o755)
  return Path(launcher)
}

beforeEach(async () => {
  root = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'health-polling-'))
})

afterEach(async () => {
  await fsPromises.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

/**
 * A start-up clock whose time moves only when a health check fires, by that check's delay, so the
 * time the runner reads is the sum of the delays it asked for. The checks and the ydoc polls run
 * after their real delays; the startup timeout never fires.
 */
function healthCheckClock(onHealthCheck: (delays: readonly number[]) => void) {
  let time = 0
  const delays: number[] = []
  const clock: StartupClock = {
    now: () => time,
    schedule: (timer, callback, delayMs) => {
      if (timer === 'startupTimeout') return
      if (timer === 'healthCheck') {
        delays.push(delayMs)
        onHealthCheck(delays)
      }
      setTimeout(() => {
        if (timer === 'healthCheck') time += delayMs
        callback()
      }, delayMs)
    },
  }
  return { clock, delays }
}

test('polls a starting engine every 25 ms for its first second, then every 250 ms', async () => {
  const project = Path(path.join(root, 'Project'))
  // The fake turns healthy once the runner has asked for three checks past the first second.
  const { clock, delays } = healthCheckClock((delays) => {
    if (delays.length === 43) fs.writeFileSync(`${project}.ready`, '')
  })
  const runner = new EnsoRunner(await fakeEnso(root), {
    engineCommand: fakeLauncherCommand,
    firstPort: HEALTH_POLLING_PORT,
    startupClock: clock,
  })
  try {
    await expect(runner.openProject(project, 'id')).resolves.toBeDefined()
  } finally {
    await runner.closeProject(project).catch(() => undefined)
  }
  // 40 checks of 25 ms fill the first second. The check that saw the fake healthy was scheduled
  // after `.ready` was written, so there are at least 43; an unhealthy answer that counted as
  // healthy would have ended the open before.
  expect(delays.length).toBeGreaterThanOrEqual(43)
  expect(delays.slice(0, 40)).toEqual(Array(40).fill(25))
  expect(delays.slice(40)).toEqual(Array(delays.length - 40).fill(250))
}, 30_000)

/** Whether a TCP connection to `port` is accepted right now. */
function accepts(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1')
    socket.once('connect', () => (socket.destroy(), resolve(true)))
    socket.once('error', () => resolve(false))
  })
}

/** A runner on the late-ydoc fake. */
async function lateYdocRunner(options: {
  startupTimeoutMs: number
  ydocWaitMs: number
  startupClock?: StartupClock
}): Promise<EnsoRunner> {
  return new EnsoRunner(await fakeEnso(root, FAKE_ENSO_LATE_YDOC), {
    engineCommand: fakeLauncherCommand,
    firstPort: HEALTH_POLLING_PORT,
    ...options,
  })
}

test('answers an open only once the ydoc port accepts connections', async () => {
  const lateRunner = await lateYdocRunner({ startupTimeoutMs: 30_000, ydocWaitMs: 10_000 })
  const project = Path(path.join(root, 'Project'))
  try {
    const sockets = await lateRunner.openProject(project, 'id')
    const resolvedAt = Date.now()
    // The fake writes down the moment just before its ydoc port starts listening (400 ms after it is
    // healthy): an open that did not wait would have resolved before it.
    const listeningAt = Number(await fsPromises.readFile(`${project}.listening`, 'utf8'))
    expect(resolvedAt).toBeGreaterThanOrEqual(listeningAt)
    // A GUI that connects now is not refused: a refused loopback connect is what made the gap
    // between `project/open` and the ydoc socket ~525 ms on Windows.
    expect(await accepts(sockets.ydocSocket.port)).toBe(true)
  } finally {
    await lateRunner.closeProject(project).catch(() => undefined)
  }
}, 30_000)

test('gives up waiting for a ydoc port that never listens, after ydocWaitMs', async () => {
  const lateRunner = await lateYdocRunner({ startupTimeoutMs: 30_000, ydocWaitMs: 600 })
  const project = Path(path.join(root, 'NoYdoc'))
  try {
    const started = Date.now()
    const sockets = await lateRunner.openProject(project, 'id')
    // The wait ran (it alone takes 600 ms after the health check) and then ended.
    expect(Date.now() - started).toBeGreaterThanOrEqual(600)
    expect(await accepts(sockets.ydocSocket.port)).toBe(false)
  } finally {
    await lateRunner.closeProject(project).catch(() => undefined)
  }
}, 30_000)

test('the startup timeout does not kill an engine that is healthy and waited for', async () => {
  // The startup timeout is held back and fired when the runner first waits between ydoc polls: the
  // engine has passed its health check, and the open is still waiting for its ydoc port.
  let firedDuringYdocWait = false
  let startupTimeout: (() => void) | undefined
  const clock: StartupClock = {
    now: () => Date.now(),
    schedule: (timer, callback, delayMs) => {
      if (timer === 'startupTimeout') {
        startupTimeout = callback
        return
      }
      if (timer === 'ydocPoll' && startupTimeout && !firedDuringYdocWait) {
        firedDuringYdocWait = true
        startupTimeout()
      }
      setTimeout(callback, delayMs)
    },
  }
  const lateRunner = await lateYdocRunner({
    startupTimeoutMs: 30_000,
    ydocWaitMs: 600,
    startupClock: clock,
  })
  const project = Path(path.join(root, 'NoYdoc'))
  try {
    const sockets = await lateRunner.openProject(project, 'id')
    expect(firedDuringYdocWait).toBe(true)
    const health = await fetch(`http://127.0.0.1:${sockets.jsonSocket.port}/_health`)
    expect(health.ok).toBe(true)
  } finally {
    await lateRunner.closeProject(project).catch(() => undefined)
  }
}, 30_000)
