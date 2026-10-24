import { describe, expect, test } from 'vitest'
import { rowsFromLines, type LogRow } from '../engineLogModel'

const texts = (rows: readonly LogRow[]) =>
  rows.map((row) => (row.kind === 'line' ? row.text : `--${row.divider}--`))

describe('rows of a window', () => {
  test('dividers mark older and newer lines; keys start at the first line', () => {
    const rows = rowsFromLines(['a', 'b'], { older: true, newer: true, firstKey: -40 })
    expect(texts(rows)).toEqual(['--truncated--', 'a', 'b', '--newer--'])
    expect(rows.filter((row) => row.kind === 'line').map((row) => row.key)).toEqual([-40, -39])
    expect(new Set(rows.map((row) => row.key)).size).toBe(4)
  })

  test('without edges, a whole file has neither divider', () => {
    expect(texts(rowsFromLines(['a', 'b']))).toEqual(['a', 'b'])
  })
})
