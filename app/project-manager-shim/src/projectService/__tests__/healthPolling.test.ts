/**
 * @file The runner polls an engine that is still starting often enough to notice it the moment it
 * is ready. The engine is a fake `enso`, a Node script that listens at once but answers `503` to
 * `/_health` for its first 300 ms, counting those early requests.
 */
import * as fs from 'node:fs/promises'
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
