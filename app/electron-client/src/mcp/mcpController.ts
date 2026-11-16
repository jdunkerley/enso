/**
 * @file Decides when the MCP server runs: owns the on/off setting and port (a JSON file), the
 * token (the environment, or the settings file), start and stop, status, and the config text
 * each client pastes. It does not import `electron`; `electron.ts` supplies the pieces.
 *
 * The token never leaves this module except inside {@link McpController.config}'s text, which the
 * caller writes to the clipboard from main.
 */
import {
  MCP_DEFAULT_PORT,
  type ClaudeDesktopSetup,
  type ClaudeDesktopStatus,
  type McpClientKind,
  type McpStatus,
} from 'enso-common/src/mcp'
import { randomBytes } from 'node:crypto'
import * as fs from 'node:fs/promises'
import type { KeyringEntryLike } from '../secretsKey'
import {
  claudeDesktopConfigFile,
  readClaudeDesktopSetup,
  writeClaudeDesktopSetup,
} from './claudeDesktop'
import { clientConfig } from './clientConfigs'

/**
 * The keychain account the MCP token used to be kept in, read once to migrate it into the settings
 * file. The service is always `Enso`. The keychain is never written for the MCP token.
 */
export const MCP_TOKEN_ACCOUNT = 'mcp-token'

const MIN_PORT = 1024
const MAX_PORT = 65535

/** Why `setEnabled` and `setPort` are refused while an environment variable fixes the setting. */
export const MCP_LOCKED_BY_ENVIRONMENT_ERROR =
  'This setting is fixed by an environment variable (ENSO_MCP_ENABLED or ENSO_MCP_PORT).'

export interface McpControllerOptions {
  /** `<userData>/mcp-settings.json`. */
  readonly settingsPath: string
  /** The folder holding Claude Desktop's `claude_desktop_config.json`; undefined where there is none. */
  readonly claudeDesktopDirectory: string | undefined
  readonly entry: (account: string) => Promise<KeyringEntryLike>
  /**
   * The app environment (`process.env`). Narrower than `NodeJS.ProcessEnv`, whose index signature
   * here admits no object literal, so tests can pass one.
   */
  readonly env: {
    readonly ENSO_MCP_TOKEN?: string | undefined
    readonly ENSO_MCP_PORT?: string | undefined
    readonly ENSO_MCP_ENABLED?: string | undefined
  }
  readonly createServer: (
    port: number,
    token: string,
  ) => { start(): Promise<void>; stop(): Promise<void>; readonly url: string }
  readonly onStatusChanged: (status: McpStatus) => void
}

type Server = ReturnType<McpControllerOptions['createServer']>

function isValidPort(port: unknown): port is number {
  return typeof port === 'number' && Number.isInteger(port) && port >= MIN_PORT && port <= MAX_PORT
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Owns the MCP server's setting, token and lifecycle. Calls are serialised. */
export class McpController {
  /** What the settings file holds. */
  private fileEnabled = false
  private filePort = MCP_DEFAULT_PORT
  /** The token the settings file holds (never sent to the window). */
  private fileToken: string | null = null
  /** Whether the keychain was already consulted for a token to migrate. */
  private keychainChecked = false
  private server: Server | null = null
  private error: string | null = null
  private queue: Promise<unknown> = Promise.resolve()
  /** Set by {@link shutdown}: from then on nothing starts a server. */
  private closed = false

  /** Nothing runs until {@link init}. */
  constructor(private readonly options: McpControllerOptions) {}

  private get envToken(): string | null {
    const token = this.options.env.ENSO_MCP_TOKEN
    return token != null && token !== '' ? token : null
  }

  private get envEnabled(): boolean {
    return this.options.env.ENSO_MCP_ENABLED === '1'
  }

  private get envPort(): number | null {
    const port = Number(this.options.env.ENSO_MCP_PORT)
    return this.options.env.ENSO_MCP_PORT != null && isValidPort(port) ? port : null
  }

  private get enabled(): boolean {
    return this.envEnabled || this.fileEnabled
  }

  private get port(): number {
    return this.envPort ?? this.filePort
  }

  /** Whether `ENSO_MCP_ENABLED` or `ENSO_MCP_PORT` is in effect. */
  private get lockedByEnvironment(): boolean {
    return this.envEnabled || this.envPort != null
  }

  /** Run `task` after every earlier call has finished. */
  private serialised<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task)
    this.queue = result.catch(() => {})
    return result
  }

  /** Reads the settings file and starts the server when enabled. Never throws. */
  init(): Promise<McpStatus> {
    return this.serialised(async () => {
      try {
        const parsed: unknown = JSON.parse(await fs.readFile(this.options.settingsPath, 'utf8'))
        if (typeof parsed === 'object' && parsed != null) {
          const { enabled, port, token } = parsed as {
            enabled?: unknown
            port?: unknown
            token?: unknown
          }
          this.fileEnabled = enabled === true
          if (isValidPort(port)) this.filePort = port
          if (typeof token === 'string' && token !== '') this.fileToken = token
        }
      } catch {
        // Missing or unreadable: the defaults.
      }
      return this.apply()
    })
  }

  /** The current status. */
  status(): McpStatus {
    return {
      enabled: this.enabled,
      port: this.port,
      running: this.server != null,
      error: this.error,
      lockedByEnvironment: this.lockedByEnvironment,
    }
  }

  /**
   * Turn the server on or off, and remember the choice. Refused while an environment variable fixes
   * the setting; after {@link shutdown}, the status without any change.
   */
  setEnabled(enabled: boolean): Promise<McpStatus> {
    return this.serialised(async () => {
      if (this.closed) return this.status()
      if (this.lockedByEnvironment) throw new Error(MCP_LOCKED_BY_ENVIRONMENT_ERROR)
      await this.save({ enabled, port: this.filePort })
      this.fileEnabled = enabled
      return this.apply()
    })
  }

  /**
   * `port` is an integer from 1024 to 65535; a running server restarts on it. Refused while an
   * environment variable fixes the setting; after {@link shutdown}, the status without any change.
   */
  setPort(port: number): Promise<McpStatus> {
    return this.serialised(async () => {
      if (this.closed) return this.status()
      if (this.lockedByEnvironment) throw new Error(MCP_LOCKED_BY_ENVIRONMENT_ERROR)
      if (!isValidPort(port)) {
        throw new Error(`The port must be a whole number from ${MIN_PORT} to ${MAX_PORT}.`)
      }
      const hadOwnEntry = await this.hasOwnClaudeDesktopEntry()
      await this.save({ enabled: this.fileEnabled, port })
      this.filePort = port
      const status = await this.apply()
      if (hadOwnEntry) await this.rewriteClaudeDesktop()
      return status
    })
  }

  /**
   * Store a new token; a running server restarts with it. After {@link shutdown}, the status
   * without any change.
   */
  replaceToken(): Promise<McpStatus> {
    return this.serialised(async () => {
      if (this.closed) return this.status()
      if (this.envToken != null) throw new Error('The token is set by ENSO_MCP_TOKEN.')
      const hadOwnEntry = await this.hasOwnClaudeDesktopEntry()
      const fresh = randomBytes(32).toString('base64url')
      await this.save({ enabled: this.fileEnabled, port: this.filePort }, fresh)
      this.fileToken = fresh
      const status = await this.apply()
      if (hadOwnEntry) await this.rewriteClaudeDesktop()
      return status
    })
  }

  /** The config text for a client. Creates the token if there is none. */
  config(client: McpClientKind): Promise<string> {
    return this.serialised(async () => {
      const token = await this.token()
      return clientConfig(client, this.url, token)
    })
  }

  /**
   * Where Claude Desktop's configuration stands against the current address and token. Reading it
   * never creates a token: with none stored, an existing entry is out of date. The result
   * also carries the file's path, for the instructions in Settings.
   */
  claudeDesktopStatus(): Promise<ClaudeDesktopStatus> {
    return this.serialised(async () => this.withConfigFile(await this.currentClaudeDesktopStatus()))
  }

  /**
   * Add or replace the `enso` entry in Claude Desktop's configuration file, with the current
   * address and token, whether or not the server is enabled. Resolves with the status read back.
   */
  setUpClaudeDesktop(): Promise<ClaudeDesktopStatus> {
    return this.serialised(async () => {
      const directory = this.options.claudeDesktopDirectory
      const found = await readClaudeDesktopSetup(directory, this.url, null)
      if (directory == null || found.state === 'notInstalled') {
        return this.withConfigFile({ state: 'notInstalled' })
      }
      return this.withConfigFile(
        await writeClaudeDesktopSetup(directory, this.url, await this.token()),
      )
    })
  }

  /**
   * Stop the server, for good: no later call starts one. Settings are untouched. A start already
   * queued before this call runs first, and is then stopped.
   */
  async shutdown(): Promise<void> {
    this.closed = true
    await this.serialised(async () => {
      await this.stopServer()
    })
  }

  /** The address the server listens on, or would. */
  private get url(): string {
    return `http://127.0.0.1:${this.port}/mcp`
  }

  /**
   * The stored token (the environment's, or the settings file's), without creating one. With
   * neither, the keychain of an earlier version is read once and a token found there is copied
   * into the settings file. A keychain that fails or is empty counts as holding nothing.
   */
  private async storedToken(): Promise<string | null> {
    if (this.envToken != null) return this.envToken
    if (this.fileToken != null) return this.fileToken
    if (this.keychainChecked) return null
    this.keychainChecked = true
    let old: string | null
    try {
      old = (await this.options.entry(MCP_TOKEN_ACCOUNT)).getPassword()
    } catch {
      return null
    }
    if (old == null || old === '') return null
    try {
      await this.save({ enabled: this.fileEnabled, port: this.filePort }, old)
    } catch (e) {
      console.warn('[MCP] could not copy the keychain token to the settings file:', e)
    }
    this.fileToken = old
    return old
  }

  private withConfigFile(setup: ClaudeDesktopSetup): ClaudeDesktopStatus {
    return { ...setup, configFile: claudeDesktopConfigFile(this.options.claudeDesktopDirectory) }
  }

  /** Claude Desktop's status. Reads the token only once the folder exists; never throws. */
  private async currentClaudeDesktopStatus(): Promise<ClaudeDesktopSetup> {
    const directory = this.options.claudeDesktopDirectory
    const withoutToken = await readClaudeDesktopSetup(directory, this.url, null)
    if (withoutToken.state === 'notInstalled' || withoutToken.state === 'unreadable') {
      return withoutToken
    }
    try {
      const token = await this.storedToken()
      return token == null ? withoutToken : await readClaudeDesktopSetup(directory, this.url, token)
    } catch {
      return { state: 'unreadable', reason: 'The token could not be read.' }
    }
  }

  /** Whether Claude Desktop's `enso` entry is exactly the one Enso wrote for the current settings. */
  private async hasOwnClaudeDesktopEntry(): Promise<boolean> {
    return (await this.currentClaudeDesktopStatus()).state === 'setUp'
  }

  /**
   * After the address or token changed, for an entry that was Enso's own: write it again so it
   * keeps working. A failure is logged, never thrown.
   */
  private async rewriteClaudeDesktop(): Promise<void> {
    const directory = this.options.claudeDesktopDirectory
    if (directory == null) return
    try {
      await writeClaudeDesktopSetup(directory, this.url, await this.token())
    } catch (e) {
      console.warn('[MCP] could not update the Claude Desktop entry:', e)
    }
  }

  /** The token from the environment or the settings file, created when there is neither. */
  private async token(): Promise<string> {
    const existing = await this.storedToken()
    if (existing != null) return existing
    const created = randomBytes(32).toString('base64url')
    try {
      await this.save({ enabled: this.fileEnabled, port: this.filePort }, created)
    } catch (e) {
      throw new Error(`The token could not be saved: ${messageOf(e)}`, { cause: e })
    }
    this.fileToken = created
    return created
  }

  private async stopServer(): Promise<void> {
    const server = this.server
    this.server = null
    if (server != null) await server.stop().catch(() => {})
  }

  /** Make the server match the settings, then report. Never throws. */
  private async apply(): Promise<McpStatus> {
    await this.stopServer()
    this.error = null
    if (this.enabled && !this.closed) {
      const port = this.port
      try {
        const server = this.options.createServer(port, await this.token())
        try {
          await server.start()
          this.server = server
        } catch (e) {
          await server.stop().catch(() => {})
          const code = (e as { code?: unknown }).code
          this.error =
            code === 'EADDRINUSE' ?
              `Port ${port} is in use by another program.`
            : `The server could not start: ${messageOf(e)}`
        }
      } catch (e) {
        this.error = messageOf(e)
      }
    }
    const status = this.status()
    try {
      this.options.onStatusChanged(status)
    } catch (e) {
      console.warn('[MCP] the status listener failed:', e)
    }
    return status
  }

  /**
   * Write the settings atomically (a temporary file, then a rename); the caller updates its state
   * only once this succeeds. The file holds the token, so it is created readable by the user only
   * (`0o600`; Windows ignores the mode). `ENSO_MCP_TOKEN` is never written.
   */
  private async save(
    settings: { enabled: boolean; port: number },
    token: string | null = this.fileToken,
  ): Promise<void> {
    const temporary = `${this.options.settingsPath}.tmp`
    const text = JSON.stringify(token == null ? settings : { ...settings, token })
    await fs.writeFile(temporary, text, { encoding: 'utf8', mode: 0o600 })
    if (token != null) await fs.chmod(temporary, 0o600)
    await fs.rename(temporary, this.options.settingsPath)
  }
}
