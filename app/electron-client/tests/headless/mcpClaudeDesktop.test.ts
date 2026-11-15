/** @file Setting up Claude Desktop (`src/mcp/claudeDesktop.ts`), in temporary folders only. */
import fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import {
  claudeDesktopConfigDirectory,
  claudeDesktopEntry,
  readClaudeDesktopSetup,
  writeClaudeDesktopSetup,
} from '../../src/mcp/claudeDesktop'

const URL = 'http://127.0.0.1:39417/mcp'
const TOKEN = 'tok-123_abc'
const FILE = 'claude_desktop_config.json'

describe('claudeDesktopConfigDirectory', () => {
  test('win32 uses APPDATA', () => {
    expect(
      claudeDesktopConfigDirectory('win32', { APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, 'h'),
    ).toBe(path.join('C:\\Users\\a\\AppData\\Roaming', 'Claude'))
  })
  test('win32 without APPDATA has none', () => {
    expect(claudeDesktopConfigDirectory('win32', {}, 'h')).toBeUndefined()
  })
  test('darwin uses Application Support', () => {
    expect(claudeDesktopConfigDirectory('darwin', {}, '/Users/a')).toBe(
      path.join('/Users/a', 'Library', 'Application Support', 'Claude'),
    )
  })
  test('linux has none', () => {
    expect(claudeDesktopConfigDirectory('linux', { APPDATA: 'x' }, '/home/a')).toBeUndefined()
  })
})

describe('claudeDesktopEntry', () => {
  test('is the mcp-remote bridge with the token only in env', () => {
    const entry = claudeDesktopEntry(URL, TOKEN)
    expect(entry).toEqual({
      command: 'npx',
      args: ['-y', 'mcp-remote', URL, '--header', 'Authorization:${ENSO_AUTH}'],
      env: { ENSO_AUTH: `Bearer ${TOKEN}` },
    })
    expect(JSON.stringify(entry.args)).not.toContain(TOKEN)
  })
})

describe('Claude Desktop config file', () => {
  let dir: string
  let file: string
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-claude-desktop-'))
    file = path.join(dir, FILE)
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(dir, { recursive: true, force: true })
  })

  describe('readClaudeDesktopSetup', () => {
    test('no directory, or a missing folder: notInstalled', async () => {
      expect(await readClaudeDesktopSetup(undefined, URL, TOKEN)).toEqual({ state: 'notInstalled' })
      expect(await readClaudeDesktopSetup(path.join(dir, 'nope'), URL, TOKEN)).toEqual({
        state: 'notInstalled',
      })
    })
    test('no file: notSetUp', async () => {
      expect(await readClaudeDesktopSetup(dir, URL, TOKEN)).toEqual({ state: 'notSetUp' })
    })
    test('no enso entry: notSetUp', async () => {
      await fs.writeFile(file, JSON.stringify({ mcpServers: { other: {} } }))
      expect(await readClaudeDesktopSetup(dir, URL, TOKEN)).toEqual({ state: 'notSetUp' })
      await fs.writeFile(file, JSON.stringify({ theme: 'dark' }))
      expect(await readClaudeDesktopSetup(dir, URL, TOKEN)).toEqual({ state: 'notSetUp' })
    })
    test('the current entry: setUp', async () => {
      await fs.writeFile(
        file,
        JSON.stringify({ mcpServers: { enso: claudeDesktopEntry(URL, TOKEN) } }),
      )
      expect(await readClaudeDesktopSetup(dir, URL, TOKEN)).toEqual({ state: 'setUp' })
    })
    test('another token or address: outOfDate', async () => {
      await fs.writeFile(
        file,
        JSON.stringify({ mcpServers: { enso: claudeDesktopEntry(URL, TOKEN) } }),
      )
      expect(await readClaudeDesktopSetup(dir, URL, 'other')).toEqual({ state: 'outOfDate' })
      expect(await readClaudeDesktopSetup(dir, 'http://127.0.0.1:1/mcp', TOKEN)).toEqual({
        state: 'outOfDate',
      })
    })
    test('invalid JSON or a bad shape: unreadable', async () => {
      await fs.writeFile(file, '{ nope')
      expect((await readClaudeDesktopSetup(dir, URL, TOKEN)).state).toBe('unreadable')
      await fs.writeFile(file, JSON.stringify({ mcpServers: [] }))
      expect((await readClaudeDesktopSetup(dir, URL, TOKEN)).state).toBe('unreadable')
      await fs.writeFile(file, '[]')
      expect((await readClaudeDesktopSetup(dir, URL, TOKEN)).state).toBe('unreadable')
    })
  })

  describe('writeClaudeDesktopSetup', () => {
    test('keeps other keys and servers, in order, and backs up the old bytes', async () => {
      const old = JSON.stringify(
        { theme: 'dark', mcpServers: { b: { command: 'b' }, a: { command: 'a' } }, z: 1 },
        null,
        4,
      )
      await fs.writeFile(file, old)
      expect(await writeClaudeDesktopSetup(dir, URL, TOKEN)).toEqual({ state: 'setUp' })
      const text = await fs.readFile(file, 'utf8')
      expect(text.endsWith('\n')).toBe(true)
      expect(text).toContain('\n  "theme"')
      const parsed = JSON.parse(text) as Record<string, unknown>
      expect(Object.keys(parsed)).toEqual(['theme', 'mcpServers', 'z'])
      expect(Object.keys(parsed.mcpServers as object)).toEqual(['b', 'a', 'enso'])
      expect(parsed).toEqual({
        theme: 'dark',
        mcpServers: {
          b: { command: 'b' },
          a: { command: 'a' },
          enso: claudeDesktopEntry(URL, TOKEN),
        },
        z: 1,
      })
      expect(await fs.readFile(`${file}.enso-backup`, 'utf8')).toBe(old)
      expect((await fs.readdir(dir)).sort()).toEqual([FILE, `${FILE}.enso-backup`])
    })
    test('replaces an existing enso entry where it was', async () => {
      await fs.writeFile(
        file,
        JSON.stringify({ mcpServers: { enso: { command: 'old' }, other: {} } }),
      )
      await writeClaudeDesktopSetup(dir, URL, TOKEN)
      const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as {
        mcpServers: Record<string, unknown>
      }
      expect(Object.keys(parsed.mcpServers)).toEqual(['enso', 'other'])
      expect(parsed.mcpServers.enso).toEqual(claudeDesktopEntry(URL, TOKEN))
    })
    test('no file: created with only the entry, and no backup', async () => {
      expect(await writeClaudeDesktopSetup(dir, URL, TOKEN)).toEqual({ state: 'setUp' })
      expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({
        mcpServers: { enso: claudeDesktopEntry(URL, TOKEN) },
      })
      expect(await fs.readdir(dir)).toEqual([FILE])
    })
    test('a file with no mcpServers gets one', async () => {
      await fs.writeFile(file, '{"a":1}')
      await writeClaudeDesktopSetup(dir, URL, TOKEN)
      expect(JSON.parse(await fs.readFile(file, 'utf8'))).toEqual({
        a: 1,
        mcpServers: { enso: claudeDesktopEntry(URL, TOKEN) },
      })
    })
    test.each(['{ nope', '[]', '{"mcpServers":[]}', '{"mcpServers":3}', 'null'])(
      'refuses %s and leaves the file as it was',
      async (bytes) => {
        await fs.writeFile(file, bytes)
        expect((await writeClaudeDesktopSetup(dir, URL, TOKEN)).state).toBe('unreadable')
        expect(await fs.readFile(file, 'utf8')).toBe(bytes)
        expect(await fs.readdir(dir)).toEqual([FILE])
      },
    )
    test('an update leaves the first backup alone, and a file with content but no entry gets one', async () => {
      await fs.writeFile(file, '{"a":1}')
      await writeClaudeDesktopSetup(dir, URL, TOKEN)
      await writeClaudeDesktopSetup(dir, URL, 'other-token')
      expect(await fs.readFile(`${file}.enso-backup`, 'utf8')).toBe('{"a":1}')
    })
    test('a replaced entry creates no backup', async () => {
      await fs.writeFile(file, JSON.stringify({ mcpServers: { enso: { command: 'old' } } }))
      await writeClaudeDesktopSetup(dir, URL, TOKEN)
      expect(await fs.readdir(dir)).toEqual([FILE])
    })
    test.each(['', '  \n\t', '﻿'])(
      'a %j file is an empty configuration: no backup',
      async (bytes) => {
        await fs.writeFile(file, bytes)
        expect(await writeClaudeDesktopSetup(dir, URL, TOKEN)).toEqual({ state: 'setUp' })
        const text = await fs.readFile(file, 'utf8')
        expect(JSON.parse(text)).toEqual({ mcpServers: { enso: claudeDesktopEntry(URL, TOKEN) } })
        expect(await fs.readdir(dir)).toEqual([FILE])
      },
    )
    test('a BOM before the JSON is read and not written back', async () => {
      await fs.writeFile(file, '﻿{"a":1}')
      expect(await writeClaudeDesktopSetup(dir, URL, TOKEN)).toEqual({ state: 'setUp' })
      const text = await fs.readFile(file, 'utf8')
      expect(text.startsWith('{')).toBe(true)
      expect(JSON.parse(text)).toMatchObject({ a: 1 })
    })
    test('comments or a trailing comma stay unreadable', async () => {
      await fs.writeFile(file, '{ "a": 1, }')
      expect((await writeClaudeDesktopSetup(dir, URL, TOKEN)).state).toBe('unreadable')
      await fs.writeFile(file, '{ // c\n "a": 1 }')
      expect((await writeClaudeDesktopSetup(dir, URL, TOKEN)).state).toBe('unreadable')
    })
    test('a failed rename leaves the original and removes the temporary file', async () => {
      await fs.writeFile(file, '{"a":1}')
      vi.spyOn(fs, 'rename').mockRejectedValue(new Error('rename refused'))
      await expect(writeClaudeDesktopSetup(dir, URL, TOKEN)).rejects.toThrow('rename refused')
      vi.restoreAllMocks()
      expect(await fs.readFile(file, 'utf8')).toBe('{"a":1}')
      expect((await fs.readdir(dir)).sort()).toEqual([FILE, `${FILE}.enso-backup`])
    })
  })
})
