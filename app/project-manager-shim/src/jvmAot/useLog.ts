/**
 * @file What the JVM says when it cannot use an AOT cache. The shim reads it from a JVM engine's
 * `use.log`; the open-time harness (`app/electron-client/perf/`) from its check launch's output.
 */

/** A record the JVM writes about a cache it could not use. */
const AOT_PROBLEM =
  /\[(?:error|warning)\]\[(?:aot|cds)[^\]]*\]|mismatch|Unable to use|unable to map|AOT cache.*(?:different|invalid|failed|disabled)/i

/**
 * A unified-logging record below `warning` (`[0.1s][info][aot] ...`). The harness's check launch
 * logs `aot` and `cds` at `info`, so that its output says what the JVM did with the cache; such a
 * record can name a feature of a cache in use as "disabled".
 */
const UNIFIED_LOG_INFO = /^(?:\[[^\]]*\])*?\[(?:info|debug|trace)\]\[/

/**
 * The first line of the JVM's output that says the AOT cache could not be used (the JVM reports
 * these as `[cds]` or `[aot]` records, or as a mismatch), or `undefined`.
 */
export function aotRejection(output: string): string | undefined {
  return output
    .split(/\r?\n/)
    .find((line) => !UNIFIED_LOG_INFO.test(line) && AOT_PROBLEM.test(line))
}
