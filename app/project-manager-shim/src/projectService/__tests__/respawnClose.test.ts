/**
 * @file A project closed while the watchdog is restarting its engine starts no engine afterwards
 * (#335): the respawn waits for the old engine to stop and then spawns a new one, which nothing
 * could close. The engine is a fake `enso`, a Node script that counts its starts and answers the
 * health check with a failure once a `<project>.sick` file exists.
 *
 * This takes the watchdog's three failed checks, three seconds apart.
 */
import * as fs from 'node:fs/promises'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { EnsoRunner } from '../ensoRunner.js'
import { Path } from '../types.js'
import { RESPAWN_CLOSE_PORT } from './testPorts.js'

const FAKE_ENSO = `
import * as fs from 'node:fs'
import * as http from 'node:http'
const args = process.argv.slice(2)
const value = (flag) => args[args.indexOf(flag) + 1]
const project = value('--path')
const startsFile = project + '.starts'
const starts = (fs.existsSync(startsFile) ? Number(fs.readFileSync(startsFile, 'utf8')) : 0) + 1
fs.writeFileSync(startsFile, String(starts))
fs.writeFileSync(project + '.port', value('--rpc-port'))
http.createServer((_request, response) => {
  response.statusCode = fs.existsSync(project + '.sick') ? 503 : 200
  response.end('ok')
}).listen(Number(value('--rpc-port')), '127.0.0.1')
const stop = () => process.exit(0)
process.stdin.on('data', stop)
process.stdin.on('end', stop)
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'respawn-close-'))
})

afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

test('a close that lands during the watchdog respawn starts no new engine', async () => {
  const runner = new EnsoRunner(await fakeEnso(root), { firstPort: RESPAWN_CLOSE_PORT })
  const project = Path(path.join(root, 'Project'))
  let closing: Promise<void> | undefined
  // The watchdog logs, then calls `respawn()` (which starts stopping the old engine) in the same
  // synchronous run: a close started here lands while the respawn waits for the old engine.
  const error = console.error.bind(console)
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    error(...args)
    if (String(args[0]).includes('times in a row, restarting')) {
      closing ??= runner.closeProject(project)
    }
  })
  await runner.openProject(project, 'id')
  await fs.writeFile(`${project}.sick`, '')
  await expect.poll(() => closing !== undefined, { timeout: 30_000, interval: 100 }).toBe(true)
  await closing
  const port = Number(await fs.readFile(`${project}.port`, 'utf8'))
  // Past the point a respawn would have started the new engine, and begun answering.
  await sleep(2_000)
  expect(await fs.readFile(`${project}.starts`, 'utf8')).toBe('1')
  await expect(
    new Promise((resolve, reject) =>
      http.get({ host: '127.0.0.1', port, path: '/_health' }, resolve).on('error', reject),
    ),
  ).rejects.toThrow()
  expect(await runner.hasRunningProjects()).toBe(false)
}, 60_000)
