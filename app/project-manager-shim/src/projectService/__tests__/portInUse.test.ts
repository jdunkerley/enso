/**
 * @file An engine that cannot bind its port, because another program took it after the search
 * found it free, does not fail the open: the runner looks for new ports and starts another engine,
 * a bounded number of times. Any other early exit still fails the open at once. The engine is a
 * fake `enso`, a Node script that counts its starts and acts on its project's name: `TakenOnce`
 * exits with the language server's bind failure on its first start, `TakenAlways` on every start,
 * `Crash` exits with code 1 and no explanation; any other answers the health check until a newline
 * on its stdin.
 */
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { EnsoRunner } from '../ensoRunner.js'
import { Path } from '../types.js'
import { PORT_IN_USE_PORT } from './testPorts.js'

/** Far beyond the time a loaded machine needs to start a Node process. */
const STARTUP_TIMEOUT_MS = 30_000

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
const mode = path.basename(project)
if (mode === 'Crash') {
  process.exit(1)
} else if (mode === 'TakenAlways' || (mode === 'TakenOnce' && starts === 1)) {
  process.stderr.write('Bind failed because of java.net.BindException: Address already in use\\n', () =>
    process.exit(1),
  )
} else {
  http.createServer((_request, response) => response.end('ok')).listen(port, '127.0.0.1')
  const stop = () => process.exit(0)
  process.stdin.on('data', stop)
  process.stdin.on('end', stop)
}
`

let root: string
let runner: EnsoRunner

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

const starts = async (project: Path) => Number(await fs.readFile(`${project}.starts`, 'utf8'))

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'port-in-use-'))
  runner = new EnsoRunner(await fakeEnso(root), {
    firstPort: PORT_IN_USE_PORT,
    startupTimeoutMs: STARTUP_TIMEOUT_MS,
  })
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

test('an engine that cannot bind its port is started again', async () => {
  const project = Path(path.join(root, 'TakenOnce'))
  await expect(runner.openProject(project, 'id')).resolves.toBeDefined()
  expect(await starts(project)).toBe(2)
  expect(await runner.isProjectRunning(project)).toBe(true)
  await runner.closeProject(project)
  expect(await runner.hasRunningProjects()).toBe(false)
}, 30_000)

test('an engine that never binds its port fails the open after a few starts', async () => {
  const project = Path(path.join(root, 'TakenAlways'))
  await expect(runner.openProject(project, 'id')).rejects.toThrow('exited with code=1')
  expect(await starts(project)).toBe(3)
  expect(await runner.hasRunningProjects()).toBe(false)
}, 30_000)

test('an engine that exits for another reason is not started again', async () => {
  const project = Path(path.join(root, 'Crash'))
  await expect(runner.openProject(project, 'id')).rejects.toThrow('exited with code=1')
  expect(await starts(project)).toBe(1)
}, 30_000)
