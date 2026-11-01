/**
 * @file The runner polls an engine that is still starting often enough to notice it the moment it
 * is ready. The engine is a fake `enso`, a Node script that listens at once but answers `503` to
 * `/_health` for its first 300 ms, counting those early requests.
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
const started = Date.now()
let early = 0
http
  .createServer((_request, response) => {
    if (Date.now() - started < 300) {
      early += 1
      fs.writeFileSync(project + '.early', String(early))
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
import * as http from 'node:http'
import * as net from 'node:net'
import * as path from 'node:path'
const args = process.argv.slice(2)
const value = (flag) => args[args.indexOf(flag) + 1]
const port = Number(value('--rpc-port'))
http.createServer((_request, response) => response.end('ok')).listen(port, '127.0.0.1')
if (path.basename(value('--path')) !== 'NoYdoc')
  setTimeout(() => net.createServer().listen(Number(process.env.LANGUAGE_SERVER_YDOC_PORT), '127.0.0.1'), 400)
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

test('polls a starting engine several times in its first 300 ms', async () => {
  const project = Path(path.join(root, 'Project'))
  await expect(runner.openProject(project, 'id')).resolves.toBeDefined()
  const early = Number(await fs.readFile(`${project}.early`, 'utf8').catch(() => '0'))
  expect(early).toBeGreaterThanOrEqual(5)
}, 30_000)

/** Whether a TCP connection to `port` is accepted right now. */
function accepts(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1')
    socket.once('connect', () => (socket.destroy(), resolve(true)))
    socket.once('error', () => resolve(false))
  })
}

test('answers an open only once the ydoc port accepts connections', async () => {
  const lateRunner = new EnsoRunner(await fakeEnso(root, FAKE_ENSO_LATE_YDOC), {
    firstPort: HEALTH_POLLING_PORT,
    startupTimeoutMs: 30_000,
    ydocWaitMs: 10_000,
  })
  const project = Path(path.join(root, 'Project'))
  try {
    const sockets = await lateRunner.openProject(project, 'id')
    // A GUI that connects now is not refused: on Windows a refused loopback connect is retried
    // only after 500 ms, which was the whole gap between `project/open` and the ydoc socket.
    expect(await accepts(sockets.ydocSocket.port)).toBe(true)
  } finally {
    await lateRunner.closeProject(project).catch(() => undefined)
  }
}, 30_000)

test('stops waiting for a ydoc port that never listens', async () => {
  const lateRunner = new EnsoRunner(await fakeEnso(root, FAKE_ENSO_LATE_YDOC), {
    firstPort: HEALTH_POLLING_PORT,
    startupTimeoutMs: 30_000,
    ydocWaitMs: 500,
  })
  const project = Path(path.join(root, 'NoYdoc'))
  try {
    const started = Date.now()
    await expect(lateRunner.openProject(project, 'id')).resolves.toBeDefined()
    expect(Date.now() - started).toBeLessThan(10_000)
  } finally {
    await lateRunner.closeProject(project).catch(() => undefined)
  }
}, 30_000)
