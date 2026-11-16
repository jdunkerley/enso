import { Ast } from '@/util/ast'
import type { Pattern } from '@/util/ast/match'
import { partition } from '@/util/data/array'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, expect, test } from 'vitest'
import { brushFilterPattern, rowPattern } from '../ScatterplotVisualization/scatterNodes'
import { findAction, parseVizActions, type VizAction } from '../vizActions'
import { pinnedDir } from './pinnedGoldens'

// The text of these nodes is pinned by `vizNodeTextSnapshot.test.ts` (once 3.2.7 rewires it); these
// cases take the actions from the pinned goldens, as the scatter plot gets them from Enso.

function actionsOf(golden: string) {
  const message: unknown = JSON.parse(
    fs.readFileSync(path.join(pinnedDir, `${golden}.json`), 'utf-8'),
  )
  return parseVizActions(message)
}

function action(golden: string, id: string): VizAction {
  const found = findAction(actionsOf(golden), id)
  if (!found) throw new Error(`${golden} has no ${id} action`)
  return found
}

function text(pattern: Pattern | undefined): string | undefined {
  return pattern?.instantiateCopied([Ast.parseExpression('operator1')!]).code()
}

describe('The brush filter node', () => {
  const brush = action('scatter_mem_table', 'brush_filter')

  test('filters the x column and one series', () => {
    expect(text(brushFilterPattern(brush, ['y'], 'x', 0, 10, -1.5, 3))).toBe(
      "operator1.filter 'x' (..Between 0 10) . filter 'y' (..Between -1.5 3)",
    )
  })

  test('filters each series, chained after the x column', () => {
    expect(text(brushFilterPattern(brush, ['y', 'z'], 'x', 1, 2, 3, 4))).toBe(
      "operator1.filter 'x' (..Between 1 2) . filter 'y' (..Between 3 4) . filter 'z' (..Between 3 4)",
    )
  })

  test('writes bounds that JS prints with an exponent in plain decimal', () => {
    expect(text(brushFilterPattern(brush, ['y'], 'x', 1e-7, 1e21, 0, 1))).toBe(
      "operator1.filter 'x' (..Between 0.0000001 1000000000000000000000) . filter 'y' (..Between 0 1)",
    )
  })

  test('writes negative bounds at both ends', () => {
    expect(text(brushFilterPattern(brush, ['y'], 'x', -3, -1, -20.5, -0.25))).toBe(
      "operator1.filter 'x' (..Between -3 -1) . filter 'y' (..Between -20.5 -0.25)",
    )
  })

  test('keeps a column name that needs quoting as text', () => {
    expect(text(brushFilterPattern(brush, ['b c'], "it's", 0, 1, 2, 3))).toBe(
      "operator1.filter 'it\\'s' (..Between 0 1) . filter 'b c' (..Between 2 3)",
    )
  })

  test('keeps a column name that looks like a number as text', () => {
    expect(text(brushFilterPattern(brush, ['2.5'], '1', 0, 1, 2, 3))).toBe(
      "operator1.filter '1' (..Between 0 1) . filter '2.5' (..Between 2 3)",
    )
  })

  test('makes no node for a bound Enso cannot write', () => {
    expect(brushFilterPattern(brush, ['y'], 'x', Number.NaN, 1, 0, 1)).toBeUndefined()
    expect(brushFilterPattern(brush, ['y'], 'x', 0, Infinity, 0, 1)).toBeUndefined()
  })

  test('is offered by every pinned scatter plot of a table, and by no column or vector', () => {
    const goldens = fs
      .readdirSync(pinnedDir)
      .filter((file) => file.startsWith('scatter_'))
      .map((file) => file.replace(/\.json$/, ''))
    const [tables, others] = partition(goldens, (golden) =>
      /^scatter_(mem|db)_(?!column)/.test(golden),
    )
    expect(tables.length).toBeGreaterThan(0)
    for (const golden of tables) {
      expect(
        text(brushFilterPattern(action(golden, 'brush_filter'), ['y'], 'x', 0, 1, 2, 3)),
        golden,
      ).toBe("operator1.filter 'x' (..Between 0 1) . filter 'y' (..Between 2 3)")
    }
    for (const golden of others) {
      expect(findAction(actionsOf(golden), 'brush_filter'), golden).toBeUndefined()
    }
  })
})

describe("A point's row node", () => {
  test('of a table', () => {
    expect(text(rowPattern(action('scatter_mem_table', 'open_row'), 3))).toBe('operator1.get_row 3')
  })

  test('of a column', () => {
    expect(text(rowPattern(action('scatter_mem_column', 'open_row'), 3))).toBe('operator1.at 3')
  })

  test('of a vector', () => {
    expect(text(rowPattern(action('scatter_vector', 'open_row'), 3))).toBe('operator1.at 3')
  })

  test('is row 0 for the first point', () => {
    expect(text(rowPattern(action('scatter_vector', 'open_row'), 0))).toBe('operator1.at 0')
  })

  test('of a range, a pair, a list or a date range', () => {
    expect(text(rowPattern(action('scatter_range', 'open_row'), 2))).toBe('operator1.at 2')
  })

  test('makes no node for a row number Enso cannot write', () => {
    expect(rowPattern(action('scatter_vector', 'open_row'), Number.NaN)).toBeUndefined()
  })
})

describe('A message without actions', () => {
  test('offers neither the brush nor the point', () => {
    // eslint-disable-next-line camelcase
    const message = { data: [], axis: {}, is_multi_series: false, error_message: null }
    expect(findAction(parseVizActions(message), 'brush_filter')).toBeUndefined()
    expect(findAction(parseVizActions(message), 'open_row')).toBeUndefined()
  })
})
