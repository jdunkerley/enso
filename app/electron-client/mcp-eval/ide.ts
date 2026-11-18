/**
 * @file Starts the packaged IDE for one task, with a user-data directory, a projects folder and an
 * MCP server of its own, and talks to it as the runner's own MCP client (spec, "Starting the
 * IDE"). Everything of a task lives under one temporary root, outside any git working tree
 * (Note [Harness Projects Are Outside Any Repository] in `perf/openTime.ts`).
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { _electron, type ElectronApplication } from 'playwright'
import { credentialFreeEnv } from '../perf/openTimeReport'
import { launcherOf } from '../tests/ideLocator'
import { killTree } from './agent'
import type { CallTool, ToolReply } from './task'

/** The directory all of a run's temporary roots are under. */
export const TEMP_BASE = path.join(os.tmpdir(), 'enso-mcp-eval')

export interface TaskRoot {
  readonly root: string
  readonly projects: string
  readonly userData: string
  readonly agentCwd: string
  readonly logs: string
}

/** Makes `<tmp>/enso-mcp-eval/<run>/<label>/` with its `projects/`, `user-data/` and `agent-cwd/`. */
export function makeTaskRoot(runName: string, label: string): TaskRoot {
  const root = path.join(TEMP_BASE, runName, label)
  const made = {
    root,
    projects: path.join(root, 'projects'),
    userData: path.join(root, 'user-data'),
    agentCwd: path.join(root, 'agent-cwd'),
    logs: path.join(root, 'engine-logs'),
  }
  for (const dir of [made.projects, made.userData, made.agentCwd, made.logs]) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return made
}

/** Removes the roots of runs older than a day, left by a killed run. */
export function removeStaleRoots(now = Date.now(), maxAgeMs = 24 * 3600 * 1000): string[] {
  const removed: string[] = []
  if (!fs.existsSync(TEMP_BASE)) return removed
  for (const entry of fs.readdirSync(TEMP_BASE, { withFileTypes: true })) {
    const full = path.join(TEMP_BASE, entry.name)
    try {
      if (now - fs.statSync(full).mtimeMs > maxAgeMs) {
        fs.rmSync(full, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
        removed.push(full)
      }
    } catch {
      // Not ours to worry about: another run may be deleting it.
    }
  }
  return removed
}

/** A port nothing listens on now: the OS picks one, and it is released at once. */
export async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() =>
        typeof address === 'object' && address != null ?
          resolve(address.port)
        : reject(new Error('No port')),
      )
    })
  })
}

/** The IDE's environment: the credential-free one, plus the test variables of this task. */
export function ideEnv(
  parent: Readonly<Record<string, string | undefined>>,
  task: TaskRoot,
  mcp: { readonly port: number; readonly token: string },
  aotDir: string | undefined,
): Record<string, string> {
  return {
    ...credentialFreeEnv(parent),
    ENSO_TEST: 'true',
    ENSO_TEST_DISABLE_GPU: '1',
    ENSO_TEST_PROJECTS_DIR: task.projects.replace(/\\/g, '/'),
    ENSO_TEST_USER_DATA_DIR: task.userData,
    ENSO_MCP_ENABLED: '1',
    ENSO_MCP_PORT: String(mcp.port),
    ENSO_MCP_TOKEN: mcp.token,
    ENSO_SPARE_ENGINE: '0',
    ENSO_LOG_DIRECTORY: task.logs,
    ...(aotDir != null ? { ENSO_JVM_AOT_DIR: aotDir } : { ENSO_JVM_AOT: '0' }),
  }
}

/** Runs the bundled launcher to the end; resolves with its exit code. */
async function runLauncher(
  launcher: string,
  args: readonly string[],
  cwd: string,
  env: Record<string, string>,
  timeoutMs = 600_000,
): Promise<number | null> {
  // The Windows launcher may be `enso.bat`, which Node spawns only through a shell.
  const useShell = launcher.endsWith('.bat')
  const quote = (s: string) => (useShell ? `"${s}"` : s)
  return await new Promise<number | null>((resolve, reject) => {
    const child = spawn(quote(launcher), args.map(quote), {
      cwd,
      env: env as NodeJS.ProcessEnv,
      shell: useShell,
      stdio: 'ignore',
    })
    const timer = setTimeout(() => killTree(child.pid), timeoutMs)
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      resolve(code)
    })
  })
}

/** Copies `from` over `to`, creating folders. */
export function copyTree(from: string, to: string): void {
  fs.cpSync(from, to, { recursive: true, force: true })
}

/**
 * Creates the project `name` in `task.projects` with the bundled launcher (so `package.yaml` is the
 * current edition's), then copies the fixture's files over it. Returns its path.
 */
export async function createProject(
  exe: string,
  task: TaskRoot,
  name: string,
  fixtureDirs: readonly string[],
): Promise<string> {
  const launcher = launcherOf(exe)
  if (!launcher) throw new Error(`No engine launcher next to ${exe}`)
  const target = path.join(task.projects, name)
  const code = await runLauncher(
    launcher,
    ['--new', target, '--new-project-name', name],
    task.projects,
    credentialFreeEnv(process.env),
  )
  if (code !== 0) throw new Error(`enso --new ${name} exited with ${String(code)}`)
  for (const dir of fixtureDirs) if (fs.existsSync(dir)) copyTree(dir, target)
  return target
}

/** A running IDE and the MCP client connected to it. */
export interface Ide {
  readonly app: ElectronApplication
  readonly call: CallTool
  /** The user-data directory the app reports. */
  readonly userData: string
  /** The IDE's version. */
  readonly version: string
  /** The PNG a tool answers, if it answers one (`get_graph_image`). */
  image(name: string, args?: Record<string, unknown>): Promise<Buffer | undefined>
  close(): Promise<void>
}

const sameFolder = (a: string, b: string) =>
  path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()

/** Turns an SDK tool result into text and an error flag. */
export function replyOf(result: Awaited<ReturnType<Client['callTool']>>): ToolReply {
  const content = (result.content ?? []) as { type: string; text?: string }[]
  return {
    isError: result.isError === true,
    text: content
      .filter((item) => item.type === 'text')
      .map((item) => item.text ?? '')
      .join('\n'),
  }
}

/**
 * Starts the IDE and connects the runner's MCP client. It refuses (and quits the IDE) when the
 * app's user-data directory is not the task's: an IDE that does not know
 * `ENSO_TEST_USER_DATA_DIR` would use the user's own profile.
 */
export async function launchIde(
  exe: string,
  task: TaskRoot,
  env: Record<string, string>,
  mcp: { readonly port: number; readonly token: string },
): Promise<Ide> {
  const app = await _electron.launch({
    executablePath: exe,
    args: ['--no-welcome-project'],
    env: env as NodeJS.ProcessEnv,
    timeout: 120_000,
  })
  let client: Client | undefined
  // Read now: a closed app no longer has a process to ask.
  const pid = app.process().pid
  const close = async () => {
    try {
      await client?.close()
    } catch {
      // The server is going away anyway.
    }
    try {
      await Promise.race([app.close(), new Promise((resolve) => setTimeout(resolve, 20_000))])
    } catch {
      // Already closed.
    }
    killTree(pid)
  }
  try {
    const userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))
    if (!sameFolder(userData, task.userData)) {
      throw new Error(
        `The IDE uses ${userData} as its user-data directory, not ${task.userData}. ` +
          'This build does not know ENSO_TEST_USER_DATA_DIR; nothing was run, so that the ' +
          'run never touches your own profile.',
      )
    }
    client = await connectClient(mcp)
    await waitForWindow(client)
    const connected = client
    const call: CallTool = async (name, args = {}) =>
      replyOf(await connected.callTool({ name, arguments: args }, undefined, { timeout: 150_000 }))
    const image: Ide['image'] = async (name, args = {}) => {
      const result = await connected.callTool({ name, arguments: args }, undefined, {
        timeout: 150_000,
      })
      const items = (result.content ?? []) as { type: string; data?: string }[]
      const png = items.find((item) => item.type === 'image')
      return png?.data != null ? Buffer.from(png.data, 'base64') : undefined
    }
    const version = await app.evaluate(({ app: electronApp }) => electronApp.getVersion())
    return { app, call, userData, version, image, close }
  } catch (e) {
    await close()
    throw e
  }
}

/** Connects an MCP client, retrying while the server starts. */
async function connectClient(mcp: { readonly port: number; readonly token: string }) {
  const end = Date.now() + 60_000
  let last: unknown
  while (Date.now() < end) {
    const client = new Client({ name: 'enso-mcp-eval', version: '1' })
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcp.port}/mcp`), {
          requestInit: { headers: { Authorization: `Bearer ${mcp.token}` } },
        }) as Parameters<Client['connect']>[0],
      )
      return client
    } catch (e) {
      last = e
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  throw new Error(`Could not connect to the IDE's MCP server: ${String(last)}`)
}

/** Waits until the window answers a tool: the dashboard (or a project) is on screen. */
async function waitForWindow(client: Client): Promise<void> {
  const end = Date.now() + 120_000
  let last = 'no answer'
  while (Date.now() < end) {
    try {
      const reply = replyOf(await client.callTool({ name: 'get_app_state', arguments: {} }))
      if (!reply.isError) return
      last = reply.text
    } catch (e) {
      last = String(e)
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw new Error(`The IDE's window did not answer in 120 s: ${last}`)
}

/** A random token for one task's MCP server. */
export const newToken = () => randomBytes(24).toString('hex')

/**
 * Opens the project at `projectPath` and waits for its graph to settle (`get_problems` until
 * nothing is pending). Throws on a failed open.
 */
export async function openAndSettle(call: CallTool, projectPath: string): Promise<void> {
  const opened = await call('open_project', { path: projectPath })
  if (opened.isError) throw new Error(`open_project failed: ${opened.text}`)
  const end = Date.now() + 240_000
  for (;;) {
    // Every node has been computed (no `unknown` before the first execution, no `pending`), and
    // the component catalogue, which `open_method` and `search_components` need, has loaded.
    const graph = await call('get_graph', { previews: false })
    if (!graph.isError) {
      const nodes = (JSON.parse(graph.text) as { nodes?: { state?: string }[] }).nodes ?? []
      const computed = nodes.every((n) => n.state !== 'unknown' && n.state !== 'pending')
      if (computed) {
        const catalogue = await call('search_components', { query: 'read', limit: 1 })
        if (!catalogue.isError) return
      }
    }
    if (Date.now() > end) throw new Error('the project did not settle in 240 s')
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
}

/** Waits until `file` has not changed for `quietMs` (the IDE saves an edit a few seconds later). */
export async function waitForFileToSettle(
  file: string,
  quietMs = 6000,
  capMs = 45_000,
): Promise<string> {
  const end = Date.now() + capMs
  let last = fs.readFileSync(file, 'utf8')
  let since = Date.now()
  while (Date.now() < end && Date.now() - since < quietMs) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    const now = fs.readFileSync(file, 'utf8')
    if (now !== last) {
      last = now
      since = Date.now()
    }
  }
  return last
}
