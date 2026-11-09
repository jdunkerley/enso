/** @file Reading how many CPUs a process may run on. */
import { describe, expect, test } from 'vitest'
import { bitCount, parseTaskset, parseWindowsAffinity } from '../../perf/cpuAffinity'

describe('cpuAffinity', () => {
  test('counts the bits of a mask', () => {
    expect(bitCount(0xffn)).toBe(8)
    expect(bitCount(0xfn)).toBe(4)
    expect(bitCount(0xffffffffn)).toBe(32)
  })

  test("reads taskset's output", () => {
    expect(parseTaskset("pid 123's current affinity mask: ff\n")).toBe(8)
    expect(parseTaskset("pid 1's current affinity mask: ffffffff,ffffffff")).toBe(64)
    expect(parseTaskset('taskset: failed')).toBeUndefined()
  })

  test("reads PowerShell's decimal mask", () => {
    expect(parseWindowsAffinity('255\r\n')).toBe(8)
    expect(parseWindowsAffinity('4294967295')).toBe(32)
    expect(parseWindowsAffinity('Get-Process : Cannot find')).toBeUndefined()
  })
})
