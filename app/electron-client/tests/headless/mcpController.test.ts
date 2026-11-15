/** @file The MCP controller (`src/mcp/mcpController.ts`): setting, token, start/stop and status. */
import type { McpStatus } from 'enso-common/src/mcp'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { MCP_TOKEN_ACCOUNT, McpController } from '../../src/mcp/mcpController'
import type { KeyringEntryLike } from '../../src/secretsKey'

/** An in-memory keyring keyed by account; the service is always `Enso`. */
class FakeKeyring {
  readonly items = new Map<string, string>()
  readonly accounts: string[] = []
  getPassword: (account: string) => string | null = (account) => this.items.get(account) ?? null

  entry = async (account: string): Promise<KeyringEntryLike> => {
    this.accounts.push(account)
    return {
      getPassword: () => this.getPassword(account),
      setPassword: (password) => void this.items.set(account, password),
      deletePassword: () => this.items.delete(account),
    }
  }
}

class FakeServer {
  started = false
  startError: unknown = null
  /** When set, `start` waits for it. */
  startGate: Promise<void> | null = null
  readonly start = vi.fn(async () => {
    if (this.startGate != null) await this.startGate
    if (this.startError != null) throw this.startError
    this.started = true
  })
  readonly stop = vi.fn(async () => {
    this.started = false
  })
  constructor(
    readonly port: number,
    readonly token: string,
  ) {}
  get url(): string {
    return `http://127.0.0.1:${this.port}/mcp`
  }
}

describe('McpController', () => {
  let dir: string
  let settingsPath: string
  let keyring: FakeKeyring
  let servers: FakeServer[]
  let statuses: McpStatus[]
  let startError: unknown
  let startGate: Promise<void> | null
  let onStatusChanged: (status: McpStatus) => void

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-controller-'))
    settingsPath = path.join(dir, 'mcp-settings.json')
    keyring = new FakeKeyring()
    servers = []
    statuses = []
    startError = null
    startGate = null
    onStatusChanged = (status) => statuses.push(status)
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  function controller(
    env: { ENSO_MCP_TOKEN?: string; ENSO_MCP_PORT?: string; ENSO_MCP_ENABLED?: string } = {},
  ): McpController {
    return new McpController({
      settingsPath,
      entry: keyring.entry,
      env,
      createServer: (port, token) => {
        const server = new FakeServer(port, token)
        server.startError = startError
        server.startGate = startGate
        servers.push(server)
        return server
      },
      onStatusChanged: (status) => onStatusChanged(status),
    })
  }

  test('with no settings file it is off and touches nothing', async () => {
    const c = controller()
    expect(await c.init()).toEqual({
      enabled: false,
      port: 39417,
      running: false,
      error: null,
      lockedByEnvironment: false,
    })
    expect(servers).toEqual([])
    expect(keyring.accounts).toEqual([])
  })

  test('setEnabled(true) creates a token, starts, and writes the file', async () => {
    const c = controller()
    await c.init()
    statuses.length = 0
    const status = await c.setEnabled(true)
    expect(status).toEqual({
      enabled: true,
      port: 39417,
      running: true,
      error: null,
      lockedByEnvironment: false,
    })
    expect(statuses).toEqual([status])
    expect(servers).toHaveLength(1)
    expect(servers[0]!.port).toBe(39417)
    expect(servers[0]!.token).toBe(keyring.items.get(MCP_TOKEN_ACCOUNT))
    expect(servers[0]!.token.length).toBeGreaterThan(20)
    expect(JSON.parse(await fs.readFile(settingsPath, 'utf8'))).toEqual({
      enabled: true,
      port: 39417,
    })
  })

  test('a second controller starts with the same token', async () => {
    await controller().setEnabled(true)
    const token = servers[0]!.token
    const second = controller()
    expect((await second.init()).running).toBe(true)
    expect(servers[1]!.token).toBe(token)
  })

  test('setEnabled(false) stops the server and keeps the token', async () => {
    const c = controller()
    await c.setEnabled(true)
    const token = keyring.items.get(MCP_TOKEN_ACCOUNT)
    const status = await c.setEnabled(false)
    expect(status).toEqual({
      enabled: false,
      port: 39417,
      running: false,
      error: null,
      lockedByEnvironment: false,
    })
    expect(servers[0]!.stop).toHaveBeenCalled()
    expect(keyring.items.get(MCP_TOKEN_ACCOUNT)).toBe(token)
  })

  test('setPort restarts a running server; bad ports reject and change nothing', async () => {
    const c = controller()
    await c.setEnabled(true)
    const status = await c.setPort(40000)
    expect(status).toEqual({
      enabled: true,
      port: 40000,
      running: true,
      error: null,
      lockedByEnvironment: false,
    })
    expect(servers[0]!.stop).toHaveBeenCalled()
    expect(servers[1]!.port).toBe(40000)
    await expect(c.setPort(80)).rejects.toThrow()
    await expect(c.setPort(1.5)).rejects.toThrow()
    await expect(c.setPort(70000)).rejects.toThrow()
    expect(c.status()).toEqual(status)
    expect(servers).toHaveLength(2)
  })

  test('a port in use gives running false with the port in the error, still enabled', async () => {
    startError = Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' })
    const c = controller()
    const status = await c.setEnabled(true)
    expect(status.enabled).toBe(true)
    expect(status.running).toBe(false)
    expect(status.error).toBe('Port 39417 is in use by another program.')
  })

  test('a keychain failure is reported and enabled stays', async () => {
    keyring.getPassword = () => {
      throw new Error('locked')
    }
    const c = controller()
    const status = await c.setEnabled(true)
    expect(status.enabled).toBe(true)
    expect(status.running).toBe(false)
    expect(status.error).toBe('The system keychain is not available: locked')
    expect(servers).toEqual([])
  })

  test('ENSO_MCP_TOKEN is used without touching the keychain, and cannot be replaced', async () => {
    const c = controller({ ENSO_MCP_TOKEN: 'from-env' })
    await c.setEnabled(true)
    expect(servers[0]!.token).toBe('from-env')
    expect(keyring.accounts).toEqual([])
    await expect(c.replaceToken()).rejects.toThrow('The token is set by ENSO_MCP_TOKEN.')
  })

  test('ENSO_MCP_ENABLED and ENSO_MCP_PORT override and are not written back', async () => {
    const c = controller({
      ENSO_MCP_TOKEN: 't',
      ENSO_MCP_ENABLED: '1',
      ENSO_MCP_PORT: '41000',
    })
    expect(await c.init()).toEqual({
      enabled: true,
      port: 41000,
      running: true,
      error: null,
      lockedByEnvironment: true,
    })
    expect(servers[0]!.port).toBe(41000)
    await expect(fs.access(settingsPath)).rejects.toThrow()
  })

  test.each([
    ['ENSO_MCP_ENABLED', { ENSO_MCP_ENABLED: '1' }],
    ['ENSO_MCP_PORT', { ENSO_MCP_PORT: '41000' }],
  ])('while %s is in effect the switch and the port are locked', async (_name, env) => {
    const c = controller({ ENSO_MCP_TOKEN: 't', ...env })
    const before = await c.init()
    expect(before.lockedByEnvironment).toBe(true)
    const locked =
      'This setting is fixed by an environment variable (ENSO_MCP_ENABLED or ENSO_MCP_PORT).'
    await expect(c.setEnabled(!before.enabled)).rejects.toThrow(locked)
    await expect(c.setPort(40000)).rejects.toThrow(locked)
    expect(c.status()).toEqual(before)
    await expect(fs.access(settingsPath)).rejects.toThrow()
  })

  test('an ENSO_MCP_PORT that is not a valid port, or ENSO_MCP_ENABLED=0, locks nothing', async () => {
    const c = controller({ ENSO_MCP_PORT: '80', ENSO_MCP_ENABLED: '0' })
    expect((await c.init()).lockedByEnvironment).toBe(false)
  })

  test('replaceToken stores a new token and restarts a running server', async () => {
    const c = controller()
    await c.setEnabled(true)
    const old = keyring.items.get(MCP_TOKEN_ACCOUNT)
    statuses.length = 0
    const status = await c.replaceToken()
    const fresh = keyring.items.get(MCP_TOKEN_ACCOUNT)
    expect(fresh).not.toBe(old)
    expect(status.running).toBe(true)
    expect(servers[0]!.stop).toHaveBeenCalled()
    expect(servers[1]!.token).toBe(fresh)
    expect(statuses).toHaveLength(1)
  })

  test('config gives the URL and the token, creating the token when there is none', async () => {
    const c = controller()
    const text = await c.config('json')
    const token = keyring.items.get(MCP_TOKEN_ACCOUNT)!
    expect(text).toContain('http://127.0.0.1:39417/mcp')
    expect(text).toContain(`Bearer ${token}`)
  })

  test('shutdown stops a running server', async () => {
    const c = controller()
    await c.setEnabled(true)
    await c.shutdown()
    expect(servers[0]!.stop).toHaveBeenCalled()
  })

  test('a throwing status listener does not reject init, and is logged', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      onStatusChanged = () => {
        throw new Error('window gone')
      }
      await fs.writeFile(settingsPath, JSON.stringify({ enabled: true, port: 39417 }))
      const status = await controller({ ENSO_MCP_TOKEN: 't' }).init()
      expect(status.running).toBe(true)
      expect(warn).toHaveBeenCalledOnce()
    } finally {
      warn.mockRestore()
    }
  })

  test('after shutdown, setEnabled, setPort and replaceToken start no server', async () => {
    const c = controller()
    await c.init()
    await c.shutdown()
    expect((await c.setEnabled(true)).running).toBe(false)
    expect((await c.setPort(40000)).running).toBe(false)
    expect((await c.replaceToken()).running).toBe(false)
    expect(servers).toEqual([])
  })

  test('shutdown while a start is pending leaves no server running', async () => {
    let open!: () => void
    startGate = new Promise((resolve) => (open = resolve))
    const c = controller({ ENSO_MCP_TOKEN: 't' })
    const enabling = c.setEnabled(true)
    const shuttingDown = c.shutdown()
    const changingPort = c.setPort(40000)
    open()
    await enabling
    await shuttingDown
    await changingPort
    expect(servers.filter((server) => server.started)).toEqual([])
    expect(c.status().running).toBe(false)
  })

  test('a settings file that cannot be written rejects and changes nothing', async () => {
    const c = controller({ ENSO_MCP_TOKEN: 't' })
    await c.init()
    const before = c.status()
    // A directory where the settings file should be: the rename fails.
    await fs.mkdir(settingsPath)
    await expect(c.setEnabled(true)).rejects.toThrow()
    await expect(c.setPort(40000)).rejects.toThrow()
    expect(c.status()).toEqual(before)
    expect(servers).toEqual([])
  })
})
