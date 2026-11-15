// The table view format's field names are snake_case (`row_count`, …).
/* eslint-disable camelcase */

/** The table visualisation's message for a vector of vectors of text: one column per item, row numbers. */
export function matrixView(rows: string[][]) {
  const columnCount = Math.max(0, ...rows.map((row) => row.length))
  return {
    kind: 'grid',
    row_count: rows.length,
    columns: Array.from({ length: columnCount }, (_, j) => ({
      name: String(j),
    })),
    index: { action: 'at {{#index}}' },
    data: Array.from({ length: columnCount }, (_, j) => rows.map((row) => row[j])),
    options: { disable_sort_when_partial: true },
  }
}
