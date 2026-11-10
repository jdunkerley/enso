/** @file Picking the engine's and the ydoc host's memory out of a process list. */
import { describe, expect, test } from 'vitest'
import {
  engineProcesses,
  engineRssKb,
  executableName,
  parseCim,
  parsePs,
  processRssKb,
  type ProcessInfo,
} from '../../perf/processRss'

const BS = String.fromCharCode(92)
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
  test('is undefined, not 0, when the engine is not running or Electron is gone', () => {
    expect(engineRssKb(windows.slice(0, 3), 100)).toBeUndefined()
    expect(engineRssKb(windows, 999)).toBeUndefined()
  })
  test('engineProcesses names the processes that were summed', () => {
    expect(engineProcesses(windows, 100).map((x) => x.pid)).toEqual([103, 104])
  })
})

describe('the IDE binary is never the engine', () => {
  // The Windows tree of dispatch 42180192094: Playwright's launcher, then the real main process.
  const ide = 'C:' + BS + 'ide' + BS + 'Enso.exe'
  const tree: ProcessInfo[] = [
    p(1, 0, 10, '"C:' + BS + 'ide' + BS + 'Enso.exe" --inspect=0'),
    p(
      2,
      1,
      180_000,
      '"C:' + BS + 'ide' + BS + 'Enso.exe"  "--inspect=0" "--remote-debugging-port=0"',
    ),
    p(3, 2, 180_000, '"C:' + BS + 'ide' + BS + 'Enso.exe" --type=gpu-process'),
    p(
      4,
      2,
      30_000,
      '"C:' +
        BS +
        'ide' +
        BS +
        'resources' +
        BS +
        'enso' +
        BS +
        'dist' +
        BS +
        'bin' +
        BS +
        'enso.exe" --server',
    ),
  ]
  test('without it the main process and its helpers are summed (the bug)', () => {
    expect(engineRssKb(tree, 1)).toBe(180_000 + 180_000 + 30_000)
  })
  test('with it only the engine is', () => {
    expect(engineRssKb(tree, 1, ide)).toBe(30_000)
    expect(engineProcesses(tree, 1, ide).map((x) => x.pid)).toEqual([4])
  })
  test('the path match ignores case and slash direction', () => {
    expect(engineRssKb(tree, 1, 'c:/IDE/enso.exe')).toBe(30_000)
  })
})

describe('processRssKb', () => {
  test('is one process, undefined when it is gone', () => {
    expect(processRssKb(windows, 102)).toBe(4000)
    expect(processRssKb(windows, 5)).toBeUndefined()
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
  test('parseCim reads private bytes as KiB when the row has them', () => {
    const row = {
      ProcessId: 5,
      ParentProcessId: 1,
      WorkingSetSize: 2_097_152,
      PrivatePageCount: 1_048_576,
      CommandLine: 'java',
    }
    expect(parseCim(JSON.stringify(row))).toEqual([{ ...p(5, 1, 2048, 'java'), privateKb: 1024 }])
  })
})
