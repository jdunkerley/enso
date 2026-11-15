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
  | { readonly ok: true; readonly text: string | null; readonly config: Record<string, unknown> }
  | { readonly ok: false; readonly reason: string }

/** The file's text and parsed content; an absent file is an empty configuration. */
async function parseConfig(file: string): Promise<Parsed> {
  let text: string
  try {
    text = await fs.readFile(file, 'utf8')
  } catch (e) {
    if (isMissing(e)) return { ok: true, text: null, config: {} }
    return { ok: false, reason: `The configuration file could not be read: ${messageOf(e)}` }
  }
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
  return { ok: true, text, config }
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

/** Where Claude Desktop's configuration stands against this address and token. */
export async function readClaudeDesktopSetup(
  directory: string | undefined,
  url: string,
  token: string,
): Promise<ClaudeDesktopSetup> {
  if (directory == null || !(await directoryExists(directory))) return { state: 'notInstalled' }
  const parsed = await parseConfig(path.join(directory, CONFIG_FILE))
  if (!parsed.ok) return { state: 'unreadable', reason: parsed.reason }
  const servers = parsed.config.mcpServers
  if (!isRecord(servers) || !(CLAUDE_DESKTOP_SERVER_NAME in servers)) return { state: 'notSetUp' }
  return isDeepStrictEqual(servers[CLAUDE_DESKTOP_SERVER_NAME], claudeDesktopEntry(url, token)) ?
      { state: 'setUp' }
    : { state: 'outOfDate' }
}

/**
 * Adds or replaces only `mcpServers.enso`, keeping every other key and server. Saves the old file
 * beside it first. Refuses (`unreadable`) a file it cannot parse. If the final rename fails the
 * original is untouched, the temporary file is removed and the error is thrown.
 */
export async function writeClaudeDesktopSetup(
  directory: string,
  url: string,
  token: string,
): Promise<ClaudeDesktopSetup> {
  const file = path.join(directory, CONFIG_FILE)
  const parsed = await parseConfig(file)
  if (!parsed.ok) return { state: 'unreadable', reason: parsed.reason }
  const servers = isRecord(parsed.config.mcpServers) ? parsed.config.mcpServers : {}
  const updated = {
    ...parsed.config,
    mcpServers: { ...servers, [CLAUDE_DESKTOP_SERVER_NAME]: claudeDesktopEntry(url, token) },
  }
  if (parsed.text != null) await fs.writeFile(`${file}${BACKUP_SUFFIX}`, parsed.text, 'utf8')
  const temporary = `${file}.tmp`
  try {
    await fs.writeFile(temporary, `${JSON.stringify(updated, null, 2)}\n`, 'utf8')
    await fs.rename(temporary, file)
  } catch (e) {
    await fs.rm(temporary, { force: true }).catch(() => {})
    throw e
  }
  return readClaudeDesktopSetup(directory, url, token)
}
