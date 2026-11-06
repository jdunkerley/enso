/** @file Picking the engine's and the ydoc host's memory out of a process list. */
import { describe, expect, test } from 'vitest'
import {
  engineRssKb,
  executableName,
  parseCim,
  parsePs,
  processRssKb,
  type ProcessInfo,
} from '../../perf/processRss'

const p = (pid: number, ppid: number, rssKb: number, command: string): ProcessInfo => ({
  pid,
  ppid,
  rssKb,
  command,
})

/** Electron (100) with a helper, the ydoc host, and `enso.exe` over `conhost.exe`; an unrelated `java`. */
const windows: ProcessInfo[] = [
  p(100, 1, 1000, '"C:\\ide\\Enso.exe"'),
  p(101, 100, 2000, '"C:\\ide\\Enso.exe" --type=renderer --lang=en'),
  p(102, 100, 4000, '"C:\\ide\\Enso.exe" --type=utility --service-sandbox-type=none'),
  p(103, 100, 30_000, '"C:\\ide\\resources\\enso\\dist\\bin\\enso.exe" --server --path P'),
  p(104, 103, 500, '\\??\\C:\\Windows\\system32\\conhost.exe 0x4'),
  p(200, 1, 999_000, '"C:\\jdk\\bin\\java.exe" -jar other.jar'),
]

describe('engineRssKb', () => {
  test("sums the engine and its child, not Electron's helpers or an unrelated java", () => {
    expect(engineRssKb(windows, 100)).toBe(30_500)
  })
  test('counts a JVM under the launcher once, with its own children', () => {
    const processes = [
      p(10, 1, 100, '/opt/ide/enso'),
      p(11, 10, 50, '/opt/ide/resources/enso/dist/bin/enso --server --jvm'),
      p(12, 11, 800, '/opt/ide/resources/enso/runtime/bin/java -XX:AOTMode=on -m org.enso.runner'),
      p(13, 12, 40, 'node-helper'),
      p(14, 10, 7, '/opt/ide/enso --type=zygote'),
    ]
    expect(engineRssKb(processes, 10)).toBe(50 + 800 + 40)
  })
  test('is 0 when the engine is not running, or Electron is gone', () => {
    expect(engineRssKb(windows.slice(0, 3), 100)).toBe(0)
    expect(engineRssKb(windows, 999)).toBe(0)
  })
})

describe('processRssKb', () => {
  test('is one process, 0 when it is gone', () => {
    expect(processRssKb(windows, 102)).toBe(4000)
    expect(processRssKb(windows, 5)).toBe(0)
  })
})

describe('executableName', () => {
  test('reads a quoted path, a Windows path with spaces, and a Unix command', () => {
    expect(executableName('"C:\\Program Files\\Enso\\enso.exe" --x')).toBe('enso.exe')
    expect(executableName('C:\\Program Files\\Enso\\java.exe -jar a')).toBe('java.exe')
    expect(executableName('/usr/bin/java -version')).toBe('java')
    expect(executableName('')).toBe('')
  })
})

describe('the parsers', () => {
  test('parsePs reads pid, ppid, rss and the command', () => {
    expect(parsePs('  12   1  2048 /bin/enso --server\n 13 12 10 java -m x y\n')).toEqual([
      p(12, 1, 2048, '/bin/enso --server'),
      p(13, 12, 10, 'java -m x y'),
    ])
  })
  test('parseCim reads an array, a single object, a null command line, and bytes as KiB', () => {
    const row = {
      ProcessId: 5,
      ParentProcessId: 1,
      WorkingSetSize: 2_097_152,
      CommandLine: null,
    }
    expect(parseCim(JSON.stringify([row]))).toEqual([p(5, 1, 2048, '')])
    expect(parseCim(JSON.stringify(row))).toEqual([p(5, 1, 2048, '')])
    expect(parseCim('')).toEqual([])
  })
})
