import { describe, expect, test } from 'vitest'
import { ReplayBuffer } from '../replayBuffer.js'

describe('ReplayBuffer', () => {
  test('numbers events from 1 and replays them oldest first', () => {
    const buffer = new ReplayBuffer<{ text: string }>(10)
    expect(buffer.oldestSeq).toBe(1)
    expect(buffer.nextSeq).toBe(1)
    expect(buffer.push({ text: 'a' })).toEqual({ text: 'a', seq: 1 })
    buffer.push({ text: 'b' })
    buffer.push({ text: 'c' })
    expect(buffer.since().map((e) => e.text)).toEqual(['a', 'b', 'c'])
    expect(buffer.since(1).map((e) => e.seq)).toEqual([2, 3])
    expect(buffer.since(3)).toEqual([])
  })

  test('keeps the newest events when full', () => {
    const buffer = new ReplayBuffer<{ n: number }>(3)
    for (let n = 1; n <= 5; n++) buffer.push({ n })
    expect(buffer.oldestSeq).toBe(3)
    expect(buffer.nextSeq).toBe(6)
    expect(buffer.since().map((e) => e.n)).toEqual([3, 4, 5])
    // An `after` older than the buffer replays what is left.
    expect(buffer.since(1).map((e) => e.seq)).toEqual([3, 4, 5])
    expect(buffer.since(4).map((e) => e.seq)).toEqual([5])
  })

  test('refuses a capacity below one', () => {
    expect(() => new ReplayBuffer(0)).toThrow('Invalid capacity 0.')
  })
})
