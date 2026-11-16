/** @file The MCP controller (`src/mcp/mcpController.ts`): setting, token, start/stop and status. */
import type { McpStatus } from 'enso-common/src/mcp'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import { clientConfig } from '../../src/mcp/clientConfigs'
import { MCP_TOKEN_ACCOUNT, McpController } from '../../src/mcp/mcpController'
import type { KeyringEntryLike } from '../../src/secretsKey'

/** An in-memory keyring keyed by account; the service is always `Enso`. */
class FakeKeyring {
  readonly items = new Map<string, string>()
  readonly accounts: string[] = []
  readonly writes: string[] = []
  getPassword: (account: string) => string | null = (account) => this.items.get(account) ?? null

  entry = async (account: string): Promise<KeyringEntryLike> => {
    this.accounts.push(account)
    return {
      getPassword: () => this.getPassword(account),
      setPassword: (password) => {
        this.writes.push(account)
        this.items.set(account, password)
      },
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
  let claudeDir: string | undefined
  let keyring: FakeKeyring
  let servers: FakeServer[]
  let statuses: McpStatus[]
  let startError: unknown
  let startGate: Promise<void> | null
  let onStatusChanged: (status: McpStatus) => void

  const fileOf = async (): Promise<Record<string, unknown>> =>
    JSON.parse(await fs.readFile(settingsPath, 'utf8')) as Record<string, unknown>

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-controller-'))
    settingsPath = path.join(dir, 'mcp-settings.json')
    claudeDir = path.join(dir, 'Claude')
    await fs.mkdir(claudeDir)
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
      claudeDesktopDirectory: claudeDir,
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
    expect(servers[0]!.token.length).toBeGreaterThan(20)
    expect(await fileOf()).toEqual({
      enabled: true,
      port: 39417,
      token: servers[0]!.token,
    })
    expect(keyring.accounts).toEqual([MCP_TOKEN_ACCOUNT])
    expect(keyring.writes).toEqual([])
  })

  test.skipIf(process.platform === 'win32')(
    'the settings file is readable by the user only',
    async () => {
      await fs.writeFile(settingsPath, JSON.stringify({ enabled: false, port: 39417 }), {
        mode: 0o644,
      })
      await controller().init()
      await controller().setEnabled(true)
      expect((await fs.stat(settingsPath)).mode & 0o777).toBe(0o600)
    },
  )

  test('a token in the file is used, and the keychain is never consulted', async () => {
    await fs.writeFile(
      settingsPath,
      JSON.stringify({ enabled: true, port: 39417, token: 'from-file', extra: 1 }),
    )
    await controller().init()
    expect(servers[0]!.token).toBe('from-file')
    expect(keyring.accounts).toEqual([])
  })

  test('a keychain token is copied to the file once and used', async () => {
    keyring.items.set(MCP_TOKEN_ACCOUNT, 'from-keychain')
    await controller().setEnabled(true)
    expect(servers[0]!.token).toBe('from-keychain')
    expect((await fileOf()).token).toBe('from-keychain')
    expect(keyring.writes).toEqual([])
    keyring.accounts.length = 0
    const second = controller()
    await second.init()
    expect(servers[1]!.token).toBe('from-keychain')
    expect(keyring.accounts).toEqual([])
  })

  test('the keychain entry is deleted after a successful migration, never written', async () => {
    keyring.items.set(MCP_TOKEN_ACCOUNT, 'from-keychain')
    await controller().setEnabled(true)
    expect(keyring.items.has(MCP_TOKEN_ACCOUNT)).toBe(false)
    expect(keyring.writes).toEqual([])
  })

  test('the keychain entry stays when the file could not be saved', async () => {
    keyring.items.set(MCP_TOKEN_ACCOUNT, 'from-keychain')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await fs.mkdir(`${settingsPath}.tmp`)
    await controller().setUpClaudeDesktop()
    expect(keyring.items.get(MCP_TOKEN_ACCOUNT)).toBe('from-keychain')
    warn.mockRestore()
  })

  test('a keychain delete that throws is ignored', async () => {
    keyring.items.set(MCP_TOKEN_ACCOUNT, 'from-keychain')
    const c = new McpController({
      settingsPath,
      claudeDesktopDirectory: claudeDir,
      entry: async () => ({
        getPassword: () => 'from-keychain',
        setPassword: () => {},
        deletePassword: () => {
          throw new Error('denied')
        },
      }),
      env: {},
      createServer: (port, token) => {
        const server = new FakeServer(port, token)
        servers.push(server)
        return server
      },
      onStatusChanged: () => {},
    })
    expect(await c.setEnabled(true)).toMatchObject({ running: true, error: null })
    expect((await fileOf()).token).toBe('from-keychain')
  })

  test('an unreadable (not missing) settings file is never written, migrated or replaced', async () => {
    keyring.items.set(MCP_TOKEN_ACCOUNT, 'from-keychain')
    // A directory where the file should be: reading fails with EISDIR, not ENOENT.
    await fs.mkdir(settingsPath)
    const c = controller()
    const status = await c.init()
    // Reported even though the server is off: the switch reads as off because of it.
    expect(status.error).toMatch(/^The MCP settings file could not be read: /)
    expect(status.running).toBe(false)
    const enabled = await c.setEnabled(true).catch((e: unknown) => e)
    expect(enabled).toBeInstanceOf(Error)
    await expect(c.setUpClaudeDesktop()).rejects.toThrow('The MCP settings file could not be read')
    expect(keyring.accounts).toEqual([])
    expect(keyring.items.get(MCP_TOKEN_ACCOUNT)).toBe('from-keychain')
    expect(servers).toEqual([])
    expect((await fs.stat(settingsPath)).isDirectory()).toBe(true)
  })

  test('an enabled server does not start when the settings file cannot be read', async () => {
    await fs.mkdir(settingsPath)
    const c = controller({ ENSO_MCP_ENABLED: '1' })
    const status = await c.init()
    expect(status.running).toBe(false)
    expect(status.error).toMatch(/^The MCP settings file could not be read: /)
    expect(servers).toEqual([])
  })

  test('a malformed settings file is the defaults', async () => {
    await fs.writeFile(settingsPath, '{ not json')
    expect(await controller().init()).toMatchObject({ enabled: false, port: 39417, error: null })
  })

  test('a leftover temporary file is replaced, not written into', async () => {
    await fs.writeFile(`${settingsPath}.tmp`, 'stale', { mode: 0o644 })
    await controller().setEnabled(true)
    expect((await fileOf()).token).toBe(servers[0]!.token)
    await expect(fs.access(`${settingsPath}.tmp`)).rejects.toThrow()
    if (process.platform !== 'win32') {
      expect((await fs.stat(settingsPath)).mode & 0o777).toBe(0o600)
    }
  })

  test('a keychain read failure then a new token logs one line without the token', async () => {
    keyring.getPassword = () => {
      throw new Error('locked')
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await controller().setEnabled(true)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]![0])).not.toContain(servers[0]!.token)
    warn.mockRestore()
  })

  test('a file token survives init, setEnabled and setPort', async () => {
    await fs.writeFile(settingsPath, JSON.stringify({ enabled: false, port: 39417, token: 'kept' }))
    const c = controller()
    await c.init()
    await c.setEnabled(true)
    await c.setPort(40000)
    expect(await fileOf()).toEqual({ enabled: true, port: 40000, token: 'kept' })
    expect(servers.at(-1)!.token).toBe('kept')
  })

  test('an empty keychain gives a new token in the file', async () => {
    keyring.items.set(MCP_TOKEN_ACCOUNT, '')
    await controller().setEnabled(true)
    expect((await fileOf()).token).toBe(servers[0]!.token)
    expect(servers[0]!.token.length).toBeGreaterThan(20)
    expect(keyring.writes).toEqual([])
  })

  test('a keychain that throws is not an error: a new token goes in the file', async () => {
    keyring.getPassword = () => {
      throw new Error('locked')
    }
    const status = await controller().setEnabled(true)
    expect(status).toMatchObject({ enabled: true, running: true, error: null })
    expect((await fileOf()).token).toBe(servers[0]!.token)
    expect(keyring.writes).toEqual([])
  })

  test('an unavailable keychain (entry rejects) does not stop the server either', async () => {
    const c = new McpController({
      settingsPath,
      claudeDesktopDirectory: claudeDir,
      entry: () => Promise.reject(new Error('no keychain')),
      env: {},
      createServer: (port, token) => {
        const server = new FakeServer(port, token)
        servers.push(server)
        return server
      },
      onStatusChanged: () => {},
    })
    expect(await c.setEnabled(true)).toMatchObject({ running: true, error: null })
  })

  test('the token reaches neither the status nor the window', async () => {
    const c = controller()
    const status = await c.setEnabled(true)
    const token = servers[0]!.token
    expect(JSON.stringify(status)).not.toContain(token)
    expect(JSON.stringify(c.status())).not.toContain(token)
    expect(JSON.stringify(statuses)).not.toContain(token)
    expect(Object.keys(c.status()).sort()).toEqual([
      'enabled',
      'error',
      'lockedByEnvironment',
      'port',
      'running',
    ])
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
    const token = (await fileOf()).token
    expect(token).toBeTruthy()
    const status = await c.setEnabled(false)
    expect(status).toEqual({
      enabled: false,
      port: 39417,
      running: false,
      error: null,
      lockedByEnvironment: false,
    })
    expect(servers[0]!.stop).toHaveBeenCalled()
    expect((await fileOf()).token).toBe(token)
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

  test('ENSO_MCP_TOKEN is used without touching the keychain, and cannot be replaced', async () => {
    const c = controller({ ENSO_MCP_TOKEN: 'from-env' })
    await c.setEnabled(true)
    expect(servers[0]!.token).toBe('from-env')
    expect(keyring.accounts).toEqual([])
    await expect(c.replaceToken()).rejects.toThrow('The token is set by ENSO_MCP_TOKEN.')
    expect(JSON.stringify(await fileOf())).not.toContain('from-env')
    await c.config('json')
    expect(JSON.stringify(await fileOf())).not.toContain('from-env')
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
    const old = (await fileOf()).token
    statuses.length = 0
    const status = await c.replaceToken()
    const fresh = (await fileOf()).token
    expect(fresh).not.toBe(old)
    expect(keyring.writes).toEqual([])
    expect(status.running).toBe(true)
    expect(servers[0]!.stop).toHaveBeenCalled()
    expect(servers[1]!.token).toBe(fresh)
    expect(statuses).toHaveLength(1)
  })

  test('config gives the URL and the token, creating the token when there is none', async () => {
    const c = controller()
    const text = await c.config('json')
    const token = (await fileOf()).token as string
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

  describe('Claude Desktop', () => {
    const entryOf = async (): Promise<unknown> =>
      (
        JSON.parse(
          await fs.readFile(path.join(claudeDir!, 'claude_desktop_config.json'), 'utf8'),
        ) as {
          mcpServers: Record<string, unknown>
        }
      ).mcpServers.enso

    test('status is notSetUp, then setUpClaudeDesktop writes the entry with the URL and token', async () => {
      const c = controller()
      expect(await c.claudeDesktopStatus()).toMatchObject({ state: 'notSetUp' })
      expect(await c.setUpClaudeDesktop()).toMatchObject({ state: 'setUp' })
      const token = (await fileOf()).token as string
      expect(await entryOf()).toEqual(
        JSON.parse(clientConfig('claudeDesktop', 'http://127.0.0.1:39417/mcp', token)).mcpServers
          .enso,
      )
      expect(servers).toEqual([])
    })

    test('the status carries the path of the configuration file, or null without a folder', async () => {
      expect((await controller().claudeDesktopStatus()).configFile).toBe(
        path.join(claudeDir!, 'claude_desktop_config.json'),
      )
      expect((await controller().setUpClaudeDesktop()).configFile).toBe(
        path.join(claudeDir!, 'claude_desktop_config.json'),
      )
      claudeDir = undefined
      expect(await controller().claudeDesktopStatus()).toEqual({
        state: 'notInstalled',
        configFile: null,
      })
    })

    test('without a Claude Desktop folder it is notInstalled and writes nothing', async () => {
      claudeDir = undefined
      const c = controller()
      expect(await c.claudeDesktopStatus()).toMatchObject({ state: 'notInstalled' })
      expect(await c.setUpClaudeDesktop()).toMatchObject({ state: 'notInstalled' })
    })

    test('replaceToken rewrites an existing entry with the new token', async () => {
      const c = controller()
      await c.setUpClaudeDesktop()
      await c.replaceToken()
      const fresh = (await fileOf()).token as string
      expect(await entryOf()).toMatchObject({ env: { ENSO_AUTH: `Bearer ${fresh}` } })
      expect(await c.claudeDesktopStatus()).toMatchObject({ state: 'setUp' })
    })

    test('setPort rewrites an existing entry with the new address', async () => {
      const c = controller()
      await c.setUpClaudeDesktop()
      await c.setPort(40000)
      expect(JSON.stringify(await entryOf())).toContain('http://127.0.0.1:40000/mcp')
      expect(await c.claudeDesktopStatus()).toMatchObject({ state: 'setUp' })
    })

    test('status with no directory does not touch the keychain', async () => {
      claudeDir = undefined
      const c = controller()
      expect(await c.claudeDesktopStatus()).toMatchObject({ state: 'notInstalled' })
      expect(keyring.accounts).toEqual([])
    })

    test('status with a missing folder does not touch the keychain', async () => {
      await fs.rm(claudeDir!, { recursive: true })
      const c = controller()
      expect(await c.claudeDesktopStatus()).toMatchObject({ state: 'notInstalled' })
      expect(keyring.accounts).toEqual([])
    })

    test('status with no stored token creates none: notSetUp, or outOfDate for an entry', async () => {
      const c = controller()
      expect(await c.claudeDesktopStatus()).toMatchObject({ state: 'notSetUp' })
      await fs.writeFile(
        path.join(claudeDir!, 'claude_desktop_config.json'),
        JSON.stringify({ mcpServers: { enso: { command: 'x' } } }),
      )
      expect(await c.claudeDesktopStatus()).toMatchObject({ state: 'outOfDate' })
      expect(keyring.items.size).toBe(0)
    })

    test('status migrates an existing keychain token but never creates one', async () => {
      keyring.items.set(MCP_TOKEN_ACCOUNT, 'old')
      const c = controller()
      await c.setUpClaudeDesktop()
      expect((await fileOf()).token).toBe('old')
      expect(await c.claudeDesktopStatus()).toMatchObject({ state: 'setUp' })
    })

    test('a keychain that throws does not make the status unreadable', async () => {
      keyring.getPassword = () => {
        throw new Error('no keychain')
      }
      const c = controller()
      await fs.writeFile(
        path.join(claudeDir!, 'claude_desktop_config.json'),
        JSON.stringify({ mcpServers: { enso: { command: 'x' } } }),
      )
      expect(await c.claudeDesktopStatus()).toMatchObject({ state: 'outOfDate' })
      await expect(fs.access(settingsPath)).rejects.toThrow()
    })

    test('the first set-up backs the file up; an update leaves that backup alone', async () => {
      const file = path.join(claudeDir!, 'claude_desktop_config.json')
      await fs.writeFile(file, '{"theme":"dark"}')
      const c = controller()
      await c.setUpClaudeDesktop()
      expect(await fs.readFile(`${file}.enso-backup`, 'utf8')).toBe('{"theme":"dark"}')
      await c.setPort(40000)
      await c.replaceToken()
      await c.setUpClaudeDesktop()
      expect(await fs.readFile(`${file}.enso-backup`, 'utf8')).toBe('{"theme":"dark"}')
    })

    test.each(['replaceToken', 'setPort'] as const)(
      '%s leaves a hand-edited entry byte-identical and creates no entry',
      async (operation) => {
        const file = path.join(claudeDir!, 'claude_desktop_config.json')
        const c = controller()
        await c.setUpClaudeDesktop()
        const edited = `{ "mcpServers": { "enso": { "command": "mine" } } }\n`
        await fs.writeFile(file, edited)
        await (operation === 'setPort' ? c.setPort(40000) : c.replaceToken())
        expect(await fs.readFile(file, 'utf8')).toBe(edited)
        await fs.rm(file)
        await (operation === 'setPort' ? c.setPort(40001) : c.replaceToken())
        expect(await fs.readdir(claudeDir!)).toEqual([])
      },
    )

    test('replaceToken with no entry writes nothing', async () => {
      const c = controller()
      await c.replaceToken()
      expect(await fs.readdir(claudeDir!)).toEqual([])
    })

    test('a write failure during replaceToken still resolves', async () => {
      const c = controller()
      await c.setUpClaudeDesktop()
      // A directory where the temporary file goes makes the write fail.
      await fs.mkdir(path.join(claudeDir!, 'claude_desktop_config.json.tmp'))
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const old = (await fileOf()).token
      await expect(c.replaceToken()).resolves.toMatchObject({ enabled: false })
      expect((await fileOf()).token).not.toBe(old)
      expect(warn).toHaveBeenCalled()
      warn.mockRestore()
    })

    test('setEnabled writes nothing to the file', async () => {
      const c = controller()
      await c.setEnabled(true)
      expect(await fs.readdir(claudeDir!)).toEqual([])
    })
  })
})
