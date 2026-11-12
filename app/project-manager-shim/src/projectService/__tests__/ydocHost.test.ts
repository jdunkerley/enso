/**
 * @file The ydoc host an open uses: the shim's host listens on the ydoc port before the engine
 * starts, and the engine gets a channel token. The engine is a fake `enso`, a Node script that
 * records its environment, answers the health check, and exits on a stdin newline (or at once with
 * `FAKE_ENSO_FAIL=1`).
 */
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { EnsoRunner } from '../ensoRunner.js'
import { Path } from '../types.js'
import { newChannelToken, type YdocHost } from '../ydocHost.js'
import { fakeLauncherCommand } from './fakeLauncher.js'
import { YDOC_HOST_PORT } from './testPorts.js'

const FAKE_ENSO = `
import * as fs from 'node:fs'
import * as http from 'node:http'
const args = process.argv.slice(2)
const value = (flag) => args[args.indexOf(flag) + 1]
fs.writeFileSync(value('--path') + '.env.json', JSON.stringify({
  LANGUAGE_SERVER_CHANNEL_TOKEN: process.env.LANGUAGE_SERVER_CHANNEL_TOKEN,
}))
if (process.env.FAKE_ENSO_FAIL === '1') process.exit(1)
http.createServer((_q, r) => r.end('OK')).listen(Number(value('--rpc-port')), '127.0.0.1')
process.stdin.on('data', () => process.exit(0))
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

const seenEnv = async (project: string) =>
  JSON.parse(await fs.readFile(`${project}.env.json`, 'utf8')) as {
    LANGUAGE_SERVER_CHANNEL_TOKEN?: string
  }

/** Whether any engine has started in the test's root (each fake writes `<project>.env.json`). */
async function anEngineStarted(): Promise<boolean> {
  return (await fs.readdir(root)).some((name) => name.endsWith('.env.json'))
}

/** A host that records its calls as text, and whether an engine had started at each `listen`. */
function recordingHost(calls: string[], engineStartedAtListen: boolean[] = []): YdocHost {
  return {
    listen: async (r) => {
      engineStartedAtListen.push(await anEngineStarted())
      calls.push(
        `listen ${r.host}:${r.port} ls=${r.languageServer.host}:${r.languageServer.port} token=${r.languageServer.token}`,
      )
    },
    close: async (port) => void calls.push(`close ${port}`),
  }
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ydoc-host-'))
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
})

test('the host listens on the ydoc port before the engine starts, with the engine token', async () => {
  const calls: string[] = []
  const engineStartedAtListen: boolean[] = []
  const runner = new EnsoRunner(await fakeEnso(root), {
    engineCommand: fakeLauncherCommand,
    firstPort: YDOC_HOST_PORT,
    ydocHost: recordingHost(calls, engineStartedAtListen),
  })
  const p = path.join(root, 'N')
  const sockets = await runner.openProject(Path(p), 'id-n')
  const seen = await seenEnv(p)
  expect(seen.LANGUAGE_SERVER_CHANNEL_TOKEN).toMatch(/^[0-9a-f]{64}$/)
  expect(calls).toEqual([
    `listen 127.0.0.1:${sockets.ydocSocket.port} ls=127.0.0.1:${sockets.jsonSocket.port} token=${seen.LANGUAGE_SERVER_CHANNEL_TOKEN}`,
  ])
  expect(engineStartedAtListen).toEqual([false])
  await runner.closeProject(Path(p))
  expect(calls.at(-1)).toBe(`close ${sockets.ydocSocket.port}`)
})

test('without a host the engine still starts, with a token', async () => {
  const runner = new EnsoRunner(await fakeEnso(root), {
    engineCommand: fakeLauncherCommand,
    firstPort: YDOC_HOST_PORT,
  })
  const p = path.join(root, 'W')
  await runner.openProject(Path(p), 'id-w')
  expect((await seenEnv(p)).LANGUAGE_SERVER_CHANNEL_TOKEN).toMatch(/^[0-9a-f]{64}$/)
  await runner.closeProject(Path(p))
})

test('each engine gets its own token', async () => {
  const calls: string[] = []
  const runner = new EnsoRunner(await fakeEnso(root), {
    engineCommand: fakeLauncherCommand,
    firstPort: YDOC_HOST_PORT,
    ydocHost: recordingHost(calls),
  })
  const a = path.join(root, 'A')
  const b = path.join(root, 'B')
  await runner.openProject(Path(a), 'id-a')
  await runner.openProject(Path(b), 'id-b')
  const tokenA = (await seenEnv(a)).LANGUAGE_SERVER_CHANNEL_TOKEN
  const tokenB = (await seenEnv(b)).LANGUAGE_SERVER_CHANNEL_TOKEN
  expect(tokenA).not.toBe(tokenB)
  await runner.closeProject(Path(a))
  await runner.closeProject(Path(b))
})

test('a failed open closes the listener', async () => {
  const calls: string[] = []
  vi.stubEnv('FAKE_ENSO_FAIL', '1')
  const runner = new EnsoRunner(await fakeEnso(root), {
    engineCommand: fakeLauncherCommand,
    firstPort: YDOC_HOST_PORT,
    ydocHost: recordingHost(calls),
  })
  const p = path.join(root, 'F')
  await expect(runner.openProject(Path(p), 'id-f')).rejects.toThrow()
  expect(calls).toHaveLength(2)
  const port = /^listen 127\.0\.0\.1:(\d+) /.exec(calls[0] ?? '')?.[1]
  expect(calls[1]).toBe(`close ${port}`)
})

test('a listener that cannot start fails the open before an engine starts', async () => {
  const host: YdocHost = {
    listen: () => Promise.reject(new Error('listen EACCES')),
    close: vi.fn(async () => {}),
  }
  const runner = new EnsoRunner(await fakeEnso(root), {
    engineCommand: fakeLauncherCommand,
    firstPort: YDOC_HOST_PORT,
    ydocHost: host,
  })
  const p = path.join(root, 'L')
  await expect(runner.openProject(Path(p), 'id-l')).rejects.toThrow(/listen EACCES/)
  await expect(fs.access(`${p}.env.json`)).rejects.toThrow()
  expect(await runner.hasRunningProjects()).toBe(false)
})

test('a ydoc port taken before the listener binds it makes the open search again', async () => {
  const calls: string[] = []
  const recording = recordingHost(calls)
  let first = true
  const host: YdocHost = {
    listen: async (r) => {
      if (first) {
        first = false
        throw new Error(`listen EADDRINUSE: address already in use 127.0.0.1:${r.port}`)
      }
      await recording.listen(r)
    },
    close: recording.close,
  }
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const runner = new EnsoRunner(await fakeEnso(root), {
    engineCommand: fakeLauncherCommand,
    firstPort: YDOC_HOST_PORT,
    ydocHost: host,
  })
  const p = path.join(root, 'U')
  const sockets = await runner.openProject(Path(p), 'id-u')
  expect(warn).toHaveBeenCalledOnce()
  warn.mockRestore()
  expect(calls).toHaveLength(1)
  expect(calls[0]).toMatch(new RegExp(`^listen 127\\.0\\.0\\.1:${sockets.ydocSocket.port} `))
  await runner.closeProject(Path(p))
})

test('newChannelToken: 32 random bytes as hex', () => {
  expect(newChannelToken()).toMatch(/^[0-9a-f]{64}$/)
  expect(newChannelToken()).not.toBe(newChannelToken())
})
