/**
 * @file The runner polls an engine that is still starting often enough to notice it the moment it
 * is ready. The engine is a fake `enso`, a Node script that listens at once but answers `503` to
 * `/_health` for its first 8 requests, recording when each came. It counts requests, not time: a
 * window measured in time (the first 300 ms after the process start) held only 3 or 4 polls on a
 * loaded runner, whose Node start-up ate it. The test asserts the polling interval (the typical gap
 * between polls), which a loaded machine stretches far less than it shrinks a count.
 *
 * It also holds an open until the engine's ydoc port accepts connections (Note [Open Waits For The
 * Ydoc Port] in `ensoRunner.ts`), with a second fake: it answers the health check at once and
 * listens on the ydoc port 400 ms later. The two share the file's port band.
 */
import * as fs from 'node:fs/promises'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { EnsoRunner } from '../ensoRunner.js'
import { Path } from '../types.js'
import { HEALTH_POLLING_PORT } from './testPorts.js'

const FAKE_ENSO = `
import * as fs from 'node:fs'
import * as http from 'node:http'
const args = process.argv.slice(2)
const value = (flag) => args[args.indexOf(flag) + 1]
const project = value('--path')
const port = Number(value('--rpc-port'))
let started = 0
const early = []
http
  .createServer((_request, response) => {
    if (started === 0) started = Date.now()
    if (early.length < 8) {
      early.push(Date.now() - started)
      fs.writeFileSync(project + '.early', JSON.stringify(early))
      response.statusCode = 503
      response.end('starting')
    } else response.end('ok')
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
const started = Date.now()
// SlowHealth answers 503 for its first second, so that health passes near a short startup timeout.
const healthyAfter = name === 'SlowHealth' ? 1000 : 0
http
  .createServer((_request, response) => {
    response.statusCode = Date.now() - started < healthyAfter ? 503 : 200
    response.end('ok')
  })
  .listen(port, '127.0.0.1')
// NoYdoc and SlowHealth never listen on the ydoc port. Otherwise the time at which it does is
// written down, so that a test can compare it with the moment the open resolved.
if (name !== 'NoYdoc' && name !== 'SlowHealth')
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
let runner: EnsoRunner

/** Write the fake executable: a `.bat` on Windows (as the runner expects), a script elsewhere. */
async function fakeEnso(directory: string, source: string = FAKE_ENSO): Promise<Path> {
  const script = path.join(directory, 'fake-enso.mjs')
  await fs.writeFile(script, source)
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

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'health-polling-'))
  runner = new EnsoRunner(await fakeEnso(root), {
    firstPort: HEALTH_POLLING_PORT,
    startupTimeoutMs: 30_000,
  })
})

afterEach(async () => {
  await runner.closeProject(Path(path.join(root, 'Project'))).catch(() => undefined)
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

test('polls a starting engine every 25 ms, not every 250 ms', async () => {
  const project = Path(path.join(root, 'Project'))
  await expect(runner.openProject(project, 'id')).resolves.toBeDefined()
  const recorded = await fs.readFile(`${project}.early`, 'utf8').catch(() => '[]')
  const times: number[] = JSON.parse(recorded)
  expect(times).toHaveLength(8)
  const gaps = times
    .slice(1)
    .map((time, i) => time - times[i]!)
    .sort((a, b) => a - b)
  // The fast interval is 25 ms plus the request's own time; the slow one is 250 ms. The median gap
  // sits well between, and one slow poll on a loaded machine does not move it.
  expect(gaps[Math.floor(gaps.length / 2)]).toBeLessThan(125)
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
}): Promise<EnsoRunner> {
  return new EnsoRunner(await fakeEnso(root, FAKE_ENSO_LATE_YDOC), {
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
    const listeningAt = Number(await fs.readFile(`${project}.listening`, 'utf8'))
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
  // Healthy after ~1 s, startup timeout at 1.7 s, and a ydoc wait of 2.5 s that never ends early:
  // the timeout falls inside the wait.
  const lateRunner = await lateYdocRunner({ startupTimeoutMs: 1700, ydocWaitMs: 2500 })
  const project = Path(path.join(root, 'SlowHealth'))
  try {
    const sockets = await lateRunner.openProject(project, 'id')
    const health = await fetch(`http://127.0.0.1:${sockets.jsonSocket.port}/_health`)
    expect(health.ok).toBe(true)
  } finally {
    await lateRunner.closeProject(project).catch(() => undefined)
  }
}, 30_000)
