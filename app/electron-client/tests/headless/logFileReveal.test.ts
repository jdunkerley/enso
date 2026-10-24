/** @file Which paths the Logs panel's reveal button may show: files under the engine log directory. */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { resolveLogFileToReveal, type RevealFileSystem } from '../../src/logFileReveal'

let root: string
let logDir: string
let logFile: string

beforeEach(() => {
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'log-reveal-')))
  logDir = path.join(root, 'log')
  fs.mkdirSync(path.join(logDir, 'project-key'), { recursive: true })
  logFile = path.join(logDir, 'project-key', 'enso-language-server-2026-10-24-09-00-00.log')
  fs.writeFileSync(logFile, 'line\n')
  fs.writeFileSync(path.join(root, 'secret.txt'), 'not a log\n')
  fs.mkdirSync(path.join(root, 'log-other'))
  fs.writeFileSync(path.join(root, 'log-other', 'x.log'), 'x\n')
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('resolveLogFileToReveal', () => {
  test('accepts a log file under the log directory', () => {
    expect(resolveLogFileToReveal(logFile, logDir)).toEqual({ ok: true, file: logFile })
  })

  test('accepts it however it is spelt, once resolved', () => {
    const roundabout = path.join(logDir, 'project-key', '..', 'project-key', path.basename(logFile))
    expect(resolveLogFileToReveal(roundabout, logDir)).toEqual({ ok: true, file: logFile })
  })

  test('refuses a file outside the log directory, by traversal or by a shared prefix', () => {
    expect(resolveLogFileToReveal(path.join(root, 'secret.txt'), logDir)).toEqual({
      ok: false,
      reason: 'outside',
    })
    expect(resolveLogFileToReveal(path.join(logDir, '..', 'secret.txt'), logDir)).toMatchObject({
      reason: 'outside',
    })
    expect(resolveLogFileToReveal(path.join(root, 'log-other', 'x.log'), logDir)).toMatchObject({
      reason: 'outside',
    })
  })

  test('refuses the directory itself, a subdirectory and a missing file', () => {
    expect(resolveLogFileToReveal(logDir, logDir)).toMatchObject({ reason: 'outside' })
    expect(resolveLogFileToReveal(path.join(logDir, 'project-key'), logDir)).toMatchObject({
      reason: 'not-a-file',
    })
    expect(resolveLogFileToReveal(path.join(logDir, 'nope.log'), logDir)).toMatchObject({
      reason: 'missing',
    })
  })

  test('refuses UNC paths without touching them', () => {
    const touched: string[] = []
    const fileSystem: RevealFileSystem = {
      realpath: (target) => {
        touched.push(target)
        return target
      },
      isFile: () => true,
    }
    for (const unc of [
      '\\\\attacker\\share\\x.log',
      '//attacker/share/x.log',
      '\\\\?\\UNC\\attacker\\share\\x.log',
    ]) {
      expect(resolveLogFileToReveal(unc, 'C:\\log', { platform: 'win32', fileSystem })).toEqual({
        ok: false,
        reason: 'unc',
      })
    }
    expect(touched).toEqual([])
  })

  test('refuses a link inside the directory that resolves to a share', () => {
    const fileSystem: RevealFileSystem = {
      realpath: (target) =>
        target.toLowerCase().endsWith('link.log') ? '\\\\attacker\\share\\x.log' : target,
      isFile: () => true,
    }
    expect(
      resolveLogFileToReveal('C:\\log\\link.log', 'C:\\log', { platform: 'win32', fileSystem }),
    ).toEqual({ ok: false, reason: 'unc' })
  })

  test('compares case-insensitively on Windows, case-sensitively on Linux', () => {
    const fileSystem: RevealFileSystem = { realpath: (target) => target, isFile: () => true }
    expect(
      resolveLogFileToReveal(
        'c:\\USERS\\me\\AppData\\Local\\enso\\LOG\\k\\a.log',
        'C:\\Users\\me\\AppData\\Local\\enso\\log',
        {
          platform: 'win32',
          fileSystem,
        },
      ),
    ).toMatchObject({ ok: true })
    expect(
      resolveLogFileToReveal('/home/me/.cache/ENSO/k/a.log', '/home/me/.cache/enso', {
        platform: 'linux',
        fileSystem,
      }),
    ).toMatchObject({ ok: false, reason: 'outside' })
  })

  test('refuses anything but a non-empty string', () => {
    for (const requested of [undefined, null, 42, {}, '', 'a\0b']) {
      expect(resolveLogFileToReveal(requested, logDir)).toEqual({
        ok: false,
        reason: 'not-a-string',
      })
    }
  })
})
