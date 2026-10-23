/**
 * @file `EnsoRunner.hasRunningProjects` and `ProjectService.hasRunningProjects`, against a fake
 * `enso` executable: a Node script that answers the language server's health check in `--server`
 * mode, and in `--run` mode waits for a `<project>.stop` file.
 */
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { EnsoRunner } from '../ensoRunner.js'
import { ProjectService } from '../index.js'
import { Path } from '../types.js'

const FAKE_ENSO = `
import * as fs from 'node:fs'
import * as http from 'node:http'
const args = process.argv.slice(2)
const value = (flag) => args[args.indexOf(flag) + 1]
if (args.includes('--server')) {
  const server = http.createServer((_request, response) => response.end('ok'))
  server.listen(Number(value('--rpc-port')), '127.0.0.1')
  // The runner closes a language server by writing a newline to its stdin.
  const stop = () => process.exit(0)
  process.stdin.on('data', stop)
  process.stdin.on('end', stop)
} else if (args.includes('--run')) {
  const stopFile = value('--run') + '.stop'
  const poll = setInterval(() => {
    if (fs.existsSync(stopFile)) {
      clearInterval(poll)
      process.exit(0)
    }
  }, 20)
}
`

/**
 * Clear of the ports other test files' engines use, real or fake: they run in other processes, so
 * a port both find free goes to whichever binds it first, and the other engine exits with code 1.
 */
const FIRST_PORT = 42_616

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
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'running-projects-'))
  runner = new EnsoRunner(await fakeEnso(root), { firstPort: FIRST_PORT })
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

describe('hasRunningProjects', () => {
  test('is false with nothing started', async () => {
    expect(await runner.hasRunningProjects()).toBe(false)
    expect(await new ProjectService(runner, []).hasRunningProjects()).toBe(false)
  })

  test('counts an opened project until it is closed, loading included', async () => {
    const project = Path(path.join(root, 'Project'))
    const opening = runner.openProject(project, 'id')
    // A loading engine already has its environment, so it counts.
    expect(await runner.hasRunningProjects()).toBe(true)
    await opening
    expect(await runner.hasRunningProjects()).toBe(true)
    expect(await new ProjectService(runner, []).hasRunningProjects()).toBe(true)
    await runner.closeProject(project)
    expect(await runner.hasRunningProjects()).toBe(false)
  }, 30_000)

  test('counts a project run with --run until its process exits', async () => {
    const project = path.join(root, 'Batch')
    const exited = runner.runProject(Path(project))
    await expect.poll(() => runner.hasRunningProjects()).toBe(true)
    await fs.writeFile(`${project}.stop`, '')
    expect(await exited).toBe(0)
    expect(await runner.hasRunningProjects()).toBe(false)
  }, 30_000)

  test('a --run that fails to spawn does not stay counted', async () => {
    const missing = new EnsoRunner(Path(path.join(root, 'no-such-enso')))
    await expect(missing.runProject(Path(path.join(root, 'P')))).rejects.toThrow()
    expect(await missing.hasRunningProjects()).toBe(false)
  })
})
