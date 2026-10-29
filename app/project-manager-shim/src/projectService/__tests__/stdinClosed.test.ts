/**
 * @file Closing a project whose engine has stopped reading its stdin does not leave an unhandled
 * `EPIPE`: the graceful shutdown's newline fails asynchronously when the engine's end of the pipe
 * is gone, and the close still completes once the engine exits. The engine is a fake `enso`, a Node
 * script that answers the health check, closes its stdin (as an engine does on its way out, before
 * it has exited) and exits when a `<project>.exit` file appears.
 */
import * as fs from 'node:fs/promises'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { EnsoRunner } from '../ensoRunner.js'
import { Path } from '../types.js'
import { STDIN_CLOSED_PORT } from './testPorts.js'

const FAKE_ENSO = `
import * as fs from 'node:fs'
import * as http from 'node:http'
const args = process.argv.slice(2)
const value = (flag) => args[args.indexOf(flag) + 1]
const project = value('--path')
http.createServer((_request, response) => response.end('ok')).listen(Number(value('--rpc-port')), '127.0.0.1')
process.stdin.destroy()
fs.writeFileSync(project + '.stdin-closed', '')
setInterval(() => {
  if (fs.existsSync(project + '.exit')) process.exit(0)
}, 20)
`

let root: string
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

const exists = (file: string) =>
  fs.access(file).then(
    () => true,
    () => false,
  )

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'stdin-closed-'))
  unhandled = []
  // An unhandled `error` event on a stream is an uncaught exception.
  process.on('uncaughtException', onUnhandled)
})

afterEach(async () => {
  process.off('uncaughtException', onUnhandled)
  vi.restoreAllMocks()
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

test('closing a project whose engine no longer reads stdin completes without an unhandled error', async () => {
  const runner = new EnsoRunner(await fakeEnso(root), { firstPort: STDIN_CLOSED_PORT })
  const project = Path(path.join(root, 'Project'))
  await runner.openProject(project, 'id')
  await expect.poll(() => exists(`${project}.stdin-closed`), { timeout: 15_000 }).toBe(true)
  // Let the close write its newline to the closed pipe, then let the engine exit.
  // Whether the OS reports a write to a pipe the other end of which is gone depends on the host
  // (on Windows the `.bat` launcher's `cmd.exe` keeps the engine's end open), so make the newline
  // fail as it does there: asynchronously, with `EPIPE`, through the stream's `error` event.
  const realWrite = net.Socket.prototype.write
  vi.spyOn(net.Socket.prototype, 'write').mockImplementation(function (
    this: net.Socket,
    ...args: Parameters<typeof realWrite>
  ) {
    if (args[0] === '\n') {
      return this.destroy(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })) && false
    }
    return realWrite.apply(this, args)
  } as typeof realWrite)
  const closing = runner.closeProject(project)
  await new Promise((resolve) => setTimeout(resolve, 500))
  await fs.writeFile(`${project}.exit`, '')
  await expect(closing).resolves.toBeUndefined()
  expect(await runner.hasRunningProjects()).toBe(false)
  expect(unhandled).toEqual([])
}, 45_000)
