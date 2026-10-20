import { describe, expect, test } from 'vitest'
import { LineSplitter, MAX_LINE_LENGTH } from '../lineSplitter.js'

describe('LineSplitter', () => {
  test('returns complete lines and keeps a partial one', () => {
    const splitter = new LineSplitter()
    expect(splitter.push('one\ntw')).toEqual(['one'])
    expect(splitter.push('o\nthree')).toEqual(['two'])
    expect(splitter.flush()).toEqual(['three'])
    expect(splitter.flush()).toEqual([])
  })

  test('drops the carriage return of CRLF line ends, even across chunks', () => {
    const splitter = new LineSplitter()
    expect(splitter.push('a\r\nb\r')).toEqual(['a'])
    expect(splitter.push('\n')).toEqual(['b'])
  })

  test('keeps a multi-byte character split across chunks', () => {
    const splitter = new LineSplitter()
    const bytes = Buffer.from('é\n', 'utf8')
    expect(splitter.push(bytes.subarray(0, 1))).toEqual([])
    expect(splitter.push(bytes.subarray(1))).toEqual(['é'])
  })

  test('keeps empty lines', () => {
    expect(new LineSplitter().push('a\n\nb\n')).toEqual(['a', '', 'b'])
  })

  test('emits an over-long partial line in pieces', () => {
    const splitter = new LineSplitter()
    expect(splitter.push('x'.repeat(MAX_LINE_LENGTH * 2 + 5))).toEqual([
      'x'.repeat(MAX_LINE_LENGTH),
      'x'.repeat(MAX_LINE_LENGTH),
    ])
    expect(splitter.flush()).toEqual(['xxxxx'])
  })
})
