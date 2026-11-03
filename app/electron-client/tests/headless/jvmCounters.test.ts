import { describe, expect, test } from 'vitest'
import {
  hsperfDirectory,
  parseHsperfData,
  summariseJvmCounters,
  type CounterValue,
} from '../../perf/jvmCounters'

/** An hsperfdata file (format 2.0) holding `counters`, in the given byte order. */
function hsperf(counters: Record<string, CounterValue>, little = true): Uint8Array {
  const entries: Uint8Array[] = []
  for (const [name, value] of Object.entries(counters)) {
    const nameBytes = new TextEncoder().encode(name + '\0')
    const nameOffset = 20
    const dataOffset = nameOffset + Math.ceil(nameBytes.length / 8) * 8
    const valueBytes = typeof value === 'number' ? 8 : new TextEncoder().encode(value + '\0').length
    const length = dataOffset + Math.ceil(valueBytes / 8) * 8
    const entry = new Uint8Array(length)
    const view = new DataView(entry.buffer)
    view.setInt32(0, length, little)
    view.setInt32(4, nameOffset, little)
    view.setInt32(8, typeof value === 'number' ? 0 : valueBytes, little)
    view.setUint8(12, (typeof value === 'number' ? 'J' : 'B').charCodeAt(0))
    view.setInt32(16, dataOffset, little)
    entry.set(nameBytes, nameOffset)
    if (typeof value === 'number') view.setBigInt64(dataOffset, BigInt(value), little)
    else entry.set(new TextEncoder().encode(value), dataOffset)
    entries.push(entry)
  }
  const body = entries.reduce((n, e) => n + e.length, 0)
  const file = new Uint8Array(32 + body)
  const view = new DataView(file.buffer)
  view.setUint32(0, 0xcafec0c0, false)
  view.setUint8(4, little ? 1 : 0)
  view.setUint8(5, 2)
  view.setInt32(24, 32, little)
  view.setInt32(28, entries.length, little)
  let at = 32
  for (const e of entries) {
    file.set(e, at)
    at += e.length
  }
  return file
}

describe('parseHsperfData', () => {
  test('reads long and string counters, in either byte order', () => {
    for (const little of [true, false]) {
      const counters = parseHsperfData(
        hsperf({ 'java.cls.loadedClasses': 26_213, 'sun.ci.lastMethod': 'a/B c' }, little),
      )
      expect(counters.get('java.cls.loadedClasses')).toBe(26_213)
      expect(counters.get('sun.ci.lastMethod')).toBe('a/B c')
    }
  })
  test('refuses a file that is not hsperfdata', () => {
    expect(() => parseHsperfData(new Uint8Array(64))).toThrow('not an hsperfdata file')
    expect(() => parseHsperfData(new Uint8Array(4))).toThrow('not an hsperfdata file')
  })
})

describe('summariseJvmCounters', () => {
  test('converts ticks to milliseconds with the counters own frequency', () => {
    const summary = summariseJvmCounters(
      parseHsperfData(
        hsperf({
          'sun.os.hrt.frequency': 10_000_000, // Windows: 100 ns ticks
          'sun.rt.createVmBeginTime': 1_793_648_332_251,
          'java.cls.loadedClasses': 3_930,
          'java.cls.sharedLoadedClasses': 23_339,
          'sun.cls.time': 14_330_000,
          'sun.cls.classInitTime.self': 9_000_000,
          'java.ci.totalTime': 169_580_000,
          'sun.ci.totalCompiles': 17_481,
          'sun.gc.collector.0.time': 4_000_000,
          'sun.gc.collector.1.time': 90_000,
        }),
      ),
    )
    expect(summary).toEqual({
      vmStart: 1_793_648_332_251,
      loadedClasses: 3_930,
      sharedClasses: 23_339,
      classLoadMs: 1433,
      classInitMs: 900,
      compileMs: 16_958,
      compiles: 17_481,
      gcMs: 409,
    })
  })
  test('counts a missing counter as 0 and assumes nanosecond ticks', () => {
    const summary = summariseJvmCounters(new Map([['sun.cls.time', 2_000_000_000]]))
    expect(summary.classLoadMs).toBe(2000)
    expect(summary.sharedClasses).toBe(0)
  })
})

describe('hsperfDirectory', () => {
  test('is under /tmp on Linux and the temporary directory on Windows', () => {
    expect(hsperfDirectory('linux', '/var/tmp', 'runner')).toBe('/tmp/hsperfdata_runner')
    expect(hsperfDirectory('win32', 'C:\\Temp', 'runneradmin')).toBe(
      'C:\\Temp\\hsperfdata_runneradmin',
    )
  })
})
