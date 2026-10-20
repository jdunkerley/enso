/**
 * @file The runner pipes an opened project's engine stderr: every chunk still reaches this
 * process's stderr, and the project's `EngineLogSink` sees each start, each chunk and the close.
 * The engine is a fake `enso`: a Node script that answers the health check, writes to stderr and
 * crashes when a `<project>.crash` file appears.
 */
import { ChildProcessHandle } from 'enso-common/src/utilities/childProcess'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { EnsoRunner, type EngineLogSink } from '../ensoRunner.js'
import { Path } from '../types.js'

const FAKE_ENSO = `
import * as fs from 'node:fs'
import * as http from 'node:http'
const args = process.argv.slice(2)
const value = (flag) => args[args.indexOf(flag) + 1]
const project = value('--path')
const server = http.createServer((_request, response) => response.end('ok'))
server.listen(Number(value('--rpc-port')), '127.0.0.1')
const startsFile = project + '.starts'
const starts = (fs.existsSync(startsFile) ? Number(fs.readFileSync(startsFile, 'utf8')) : 0) + 1
fs.writeFileSync(startsFile, String(starts))
process.stderr.write('engine ' + starts + ' started\\n')
const stop = () => process.exit(0)
process.stdin.on('data', stop)
process.stdin.on('end', stop)
const crash = setInterval(() => {
  if (fs.existsSync(project + '.crash')) {
    fs.rmSync(project + '.crash')
    clearInterval(crash)
    process.stderr.write('crashing now\\n')
    process.exit(3)
  }
}, 20)
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

function recordingSink() {
  const calls: string[] = []
  const chunks: string[] = []
  const sink: EngineLogSink = {
    engineStarted: () => void calls.push('started'),
    engineStderr: (chunk) => {
      calls.push('stderr')
      chunks.push(chunk.toString('utf8'))
    },
    projectClosed: () => void calls.push('closed'),
  }
  return { sink, calls, stderr: () => chunks.join('').replaceAll('\r\n', '\n') }
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'engine-stderr-'))
  runner = new EnsoRunner(await fakeEnso(root))
})

afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

test("the engine's stderr reaches the sink and this process's stderr, start by start", async () => {
  const written: string[] = []
  // `as T` (not `as unknown as T`): `write` is overloaded, and this is its first overload's shape.
  vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: string | Uint8Array) => {
    written.push(Buffer.from(chunk).toString('utf8'))
    return true
  }) as typeof process.stderr.write)
  const { sink, calls, stderr } = recordingSink()
  const project = Path(path.join(root, 'Project'))
  try {
    await runner.openProject(project, 'id', undefined, undefined, sink)
    await vi.waitFor(() => expect(stderr()).toContain('engine 1 started\n'), { timeout: 15_000 })
    expect(calls[0]).toBe('started')

    await fs.writeFile(`${project}.crash`, '')
    await vi.waitFor(() => expect(stderr()).toContain('engine 2 started\n'), { timeout: 15_000 })
    expect(stderr()).toContain('crashing now\n')
    expect(calls.filter((call) => call === 'started')).toHaveLength(2)
    expect(written.join('')).toContain('engine 1 started')
    expect(written.join('')).toContain('crashing now')

    // A close whose graceful shutdown throws still tells the sink, so no tailer is left polling.
    // (Checked here rather than in a test of its own: every fake engine started in parallel with
    // other test files can race them for a port.) The shutdown's wait for the exit is the one
    // `waitForExit` call made from here on; the fake engine still exits, on the newline written
    // to its stdin.
    vi.spyOn(ChildProcessHandle.prototype, 'waitForExit').mockRejectedValueOnce(
      new Error('shutdown failed'),
    )
    await expect(runner.closeProject(project)).rejects.toThrow('shutdown failed')
    expect(calls.at(-1)).toBe('closed')
  } finally {
    // Always stop the fake engine, by the runner's own handle on it, and wait for it to exit.
    vi.restoreAllMocks()
    await runner.closeProject(project)
  }
  expect(calls.at(-1)).toBe('closed')
}, 45_000)
