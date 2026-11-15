/**
 * @file Setting up Claude Desktop: its `claude_desktop_config.json` lists local MCP servers, and
 * the IDE adds one named `enso`, the `mcp-remote` bridge to its own server. This edits another
 * application's file, so it never writes when the file cannot be parsed or is not the expected
 * shape, saves a backup first, and replaces the file atomically. No `electron` import: the folder
 * is passed in.
 */
import type { ClaudeDesktopSetup } from 'enso-common/src/mcp'
import fs from 'node:fs/promises'
import * as path from 'node:path'
import { isDeepStrictEqual } from 'node:util'

/** The name of the server entry the IDE adds. */
export const CLAUDE_DESKTOP_SERVER_NAME = 'enso'

const CONFIG_FILE = 'claude_desktop_config.json'
const BACKUP_SUFFIX = '.enso-backup'

/**
 * The folder holding `claude_desktop_config.json`, or undefined on a platform without Claude Desktop.
 */
export function claudeDesktopConfigDirectory(
  platform: NodeJS.Platform,
  env: { readonly APPDATA?: string | undefined },
  home: string,
): string | undefined {
  switch (platform) {
    case 'win32':
      return env.APPDATA != null && env.APPDATA !== '' ?
          path.join(env.APPDATA, 'Claude')
        : undefined
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', 'Claude')
    default:
      return undefined
  }
}

/** The `mcpServers.enso` value: the mcp-remote bridge, with the token in `env`, not in an argument. */
export function claudeDesktopEntry(
  url: string,
  token: string,
): { command: string; args: string[]; env: Record<string, string> } {
  return {
    command: 'npx',
    args: ['-y', 'mcp-remote', url, '--header', 'Authorization:${ENSO_AUTH}'],
    env: { ENSO_AUTH: `Bearer ${token}` },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value != null && !Array.isArray(value)
}

function isMissing(error: unknown): boolean {
  return (error as { code?: unknown }).code === 'ENOENT'
}

type Parsed =
  | {
      readonly ok: true
      /** The file's bytes, or null when it is absent or empty (nothing to back up). */
      readonly bytes: Buffer | null
      readonly config: Record<string, unknown>
    }
  | { readonly ok: false; readonly reason: string }

/**
 * The file's text and parsed content. An absent, zero-byte or whitespace-only file is an empty
 * configuration; a UTF-8 byte order mark is ignored.
 */
async function parseConfig(file: string): Promise<Parsed> {
  let bytes: Buffer
  try {
    bytes = await fs.readFile(file)
  } catch (e) {
    if (isMissing(e)) return { ok: true, bytes: null, config: {} }
    return { ok: false, reason: `The configuration file could not be read: ${messageOf(e)}` }
  }
  let text = bytes.toString('utf8')
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  if (text.trim() === '') return { ok: true, bytes: null, config: {} }
  let config: unknown
  try {
    config = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'The configuration file is not valid JSON.' }
  }
  if (!isRecord(config)) {
    return { ok: false, reason: 'The configuration file does not hold a JSON object.' }
  }
  if ('mcpServers' in config && !isRecord(config.mcpServers)) {
    return { ok: false, reason: 'The configuration file’s mcpServers is not an object.' }
  }
  return { ok: true, bytes, config }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function directoryExists(directory: string): Promise<boolean> {
  try {
    return (await fs.stat(directory)).isDirectory()
  } catch {
    return false
  }
}

/**
 * Where Claude Desktop's configuration stands against this address and token. With no `token`
 * (none stored yet), an existing `enso` entry is out of date.
 */
export async function readClaudeDesktopSetup(
  directory: string | undefined,
  url: string,
  token: string | null,
): Promise<ClaudeDesktopSetup> {
  if (directory == null || !(await directoryExists(directory))) return { state: 'notInstalled' }
  const parsed = await parseConfig(path.join(directory, CONFIG_FILE))
  if (!parsed.ok) return { state: 'unreadable', reason: parsed.reason }
  const servers = parsed.config.mcpServers
  if (!isRecord(servers) || !(CLAUDE_DESKTOP_SERVER_NAME in servers)) return { state: 'notSetUp' }
  return (
      token != null &&
        isDeepStrictEqual(servers[CLAUDE_DESKTOP_SERVER_NAME], claudeDesktopEntry(url, token))
    ) ?
      { state: 'setUp' }
    : { state: 'outOfDate' }
}

/**
 * Where to write `file`: the target of a symbolic link (an editor writes through a link; renaming
 * over it would replace the link with a file), else the file itself, absent or not.
 */
async function writeTarget(file: string): Promise<string> {
  try {
    return await fs.realpath(file)
  } catch (e) {
    if (isMissing(e)) return file
    throw e
  }
}

/** The file's permission bits, or undefined when it does not exist. */
async function modeOf(file: string): Promise<number | undefined> {
  try {
    return (await fs.stat(file)).mode & 0o777
  } catch (e) {
    if (isMissing(e)) return undefined
    throw e
  }
}

/**
 * Adds or replaces only `mcpServers.enso`, keeping every other key and server. When it adds the
 * entry to a file that has content and no `enso` entry, it first saves that file's bytes, exactly,
 * beside it (`claude_desktop_config.json.enso-backup`); replacing an existing entry leaves any
 * backup alone. So an older backup is overwritten only when the entry was removed and is then set
 * up again. Refuses (`unreadable`) a file it cannot parse. A symbolic link is written through to
 * its target, which keeps its permission bits. If the final rename fails the original is
 * untouched, the temporary file is removed and the error is thrown.
 */
export async function writeClaudeDesktopSetup(
  directory: string,
  url: string,
  token: string,
): Promise<ClaudeDesktopSetup> {
  const file = path.join(directory, CONFIG_FILE)
  const target = await writeTarget(file)
  const parsed = await parseConfig(target)
  if (!parsed.ok) return { state: 'unreadable', reason: parsed.reason }
  const servers = isRecord(parsed.config.mcpServers) ? parsed.config.mcpServers : {}
  const updated = {
    ...parsed.config,
    mcpServers: { ...servers, [CLAUDE_DESKTOP_SERVER_NAME]: claudeDesktopEntry(url, token) },
  }
  // The backup is the user's file from before Enso first touched it: made only when adding the
  // entry, never when replacing one.
  if (parsed.bytes != null && !(CLAUDE_DESKTOP_SERVER_NAME in servers))
    await fs.writeFile(`${file}${BACKUP_SUFFIX}`, parsed.bytes)
  const mode = await modeOf(target)
  // Beside the target, so that the rename stays on one file system.
  const temporary = `${target}.tmp`
  try {
    await fs.writeFile(temporary, `${JSON.stringify(updated, null, 2)}\n`, 'utf8')
    if (mode !== undefined) await fs.chmod(temporary, mode)
    await fs.rename(temporary, target)
  } catch (e) {
    await fs.rm(temporary, { force: true }).catch(() => {})
    throw e
  }
  return readClaudeDesktopSetup(directory, url, token)
}
