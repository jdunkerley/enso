/**
 * @file An engine that exits before its first health check passes fails `openProject`, and leaves
 * nothing behind: no respawned engine and no unhandled rejection. The engine is a fake `enso`: a
 * Node script that counts its starts and exits with code 1, as an engine whose port was taken does.
 */
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { EnsoRunner } from '../ensoRunner.js'
import { Path } from '../types.js'

const FAKE_ENSO = `
import * as fs from 'node:fs'
const args = process.argv.slice(2)
const project = args[args.indexOf('--path') + 1]
const startsFile = project + '.starts'
const starts = (fs.existsSync(startsFile) ? Number(fs.readFileSync(startsFile, 'utf8')) : 0) + 1
fs.writeFileSync(startsFile, String(starts))
process.exit(1)
`

/** Clear of the ports other test files' engines use, real or fake. */
const FIRST_PORT = 43_616

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
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'startup-crash-'))
  runner = new EnsoRunner(await fakeEnso(root), { firstPort: FIRST_PORT })
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

test('an engine that exits while loading fails the open and is not restarted', async () => {
  const unhandled: unknown[] = []
  const onUnhandled = (reason: unknown) => void unhandled.push(reason)
  process.on('unhandledRejection', onUnhandled)
  try {
    const project = Path(path.join(root, 'Project'))
    await expect(runner.openProject(project, 'id')).rejects.toThrow('exited with code=1')
    // A respawn follows an exit within milliseconds; give several the time to happen.
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    expect(await fs.readFile(`${project}.starts`, 'utf8')).toBe('1')
    expect(await runner.hasRunningProjects()).toBe(false)
    expect(unhandled).toEqual([])
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
}, 30_000)
