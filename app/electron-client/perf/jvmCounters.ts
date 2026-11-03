/**
 * @file A JVM's performance counters (`hsperfdata`), as the harness copies them at each phase of a
 * JVM launch (Note [JVM Counters At Each Phase] in `openTime.ts`). Pure, so that it is unit tested.
 */
import path from 'node:path'

/** Where a JVM of `user` publishes its counters: `/tmp` on Linux and macOS, the temp dir on Windows. */
export function hsperfDirectory(platform: string, tmpdir: string, user: string): string {
  return platform === 'win32' ?
      path.win32.join(tmpdir, `hsperfdata_${user}`)
    : path.posix.join('/tmp', `hsperfdata_${user}`)
}

/** A counter's value: a number (`long`), or a string (a byte vector). */
export type CounterValue = number | string

const MAGIC = 0xcafec0c0
const PROLOGUE_SIZE = 32

/**
 * The counters of an `hsperfdata` file (format 2.0): a big-endian magic, a byte-order flag, then
 * entries of `{ length, nameOffset, vectorLength, type, flags, units, variability, dataOffset }`.
 * Throws on anything that is not such a file.
 */
export function parseHsperfData(data: Uint8Array): Map<string, CounterValue> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  if (data.byteLength < PROLOGUE_SIZE || view.getUint32(0, false) !== MAGIC) {
    throw new Error('not an hsperfdata file')
  }
  const little = view.getUint8(4) === 1
  const entryOffset = view.getInt32(24, little)
  const entries = view.getInt32(28, little)
  const counters = new Map<string, CounterValue>()
  let at = entryOffset
  for (let i = 0; i < entries && at + 20 <= data.byteLength; i++) {
    const length = view.getInt32(at, little)
    const nameOffset = view.getInt32(at + 4, little)
    const vectorLength = view.getInt32(at + 8, little)
    const type = String.fromCharCode(view.getUint8(at + 12))
    const dataOffset = view.getInt32(at + 16, little)
    const nameStart = at + nameOffset
    let nameEnd = nameStart
    while (nameEnd < data.byteLength && data[nameEnd] !== 0) nameEnd++
    const name = new TextDecoder().decode(data.subarray(nameStart, nameEnd))
    const valueAt = at + dataOffset
    if (type === 'J' && vectorLength === 0 && valueAt + 8 <= data.byteLength) {
      counters.set(name, Number(view.getBigInt64(valueAt, little)))
    } else if (type === 'B') {
      const bytes = data.subarray(valueAt, valueAt + vectorLength)
      const end = bytes.indexOf(0)
      counters.set(name, new TextDecoder().decode(end < 0 ? bytes : bytes.subarray(0, end)))
    }
    if (length <= 0) break
    at += length
  }
  return counters
}

/** What a phase's counters say, in milliseconds and counts. */
export interface JvmCounterSummary {
  /** Epoch ms when the JVM started being created: picks the engine of an open. */
  readonly vmStart: number
  readonly loadedClasses: number
  /** Classes that came from the AOT (or CDS) cache. */
  readonly sharedClasses: number
  /** Thread time in class loading, of which `classInitMs` in static initialisers. */
  readonly classLoadMs: number
  readonly classInitMs: number
  /** HotSpot compiler threads' time (C1, C2 and JVMCI; not Truffle's own compilations). */
  readonly compileMs: number
  readonly compiles: number
  /** Stop-the-world GC time. */
  readonly gcMs: number
}

/** The summary of `counters`; a counter that is missing counts as 0. */
export function summariseJvmCounters(
  counters: ReadonlyMap<string, CounterValue>,
): JvmCounterSummary {
  const num = (name: string) => {
    const value = counters.get(name)
    return typeof value === 'number' ? value : 0
  }
  const ticksPerMs = (num('sun.os.hrt.frequency') || 1e9) / 1000
  const ms = (name: string) => Math.round(num(name) / ticksPerMs)
  let gcMs = 0
  for (let i = 0; i < 4; i++) gcMs += ms(`sun.gc.collector.${i}.time`)
  return {
    vmStart: num('sun.rt.createVmBeginTime'),
    loadedClasses: num('java.cls.loadedClasses'),
    sharedClasses: num('java.cls.sharedLoadedClasses'),
    classLoadMs: ms('sun.cls.time'),
    classInitMs: ms('sun.cls.classInitTime.self'),
    compileMs: ms('java.ci.totalTime'),
    compiles: num('sun.ci.totalCompiles'),
    gcMs,
  }
}
