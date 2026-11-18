import { findNumericColumn, findTextColumn } from '../../checkHelpers'
import type { TaskDefinition } from '../../task'
import { attempt, readTable } from '../helpers'

/** North's 2025 revenue (units times price) per product, largest first. */
export const EXPECTED_PRODUCTS = ['Gadget', 'Gizmo', 'Flange', 'Widget', 'Doohickey', 'Sprocket']
export const EXPECTED_TOTALS = [4151.75, 3616.75, 2850.75, 1429.25, 922.25, 481.25]

export const csvPipeline: TaskDefinition = {
  id: 'csv-pipeline',
  summary: 'Read a CSV and total the revenue per product for one region and year.',
  prompt:
    'The project has a data file, `data/sales.csv`, with the columns date, region, product, ' +
    'units and price (one row per sale). Read it and work out, for the North region in 2025, ' +
    'the total revenue (units times price) of each product, largest first. Put the final ' +
    'table in a node named `result`.',
  checks: [
    {
      name: 'result is a table of 6 rows',
      discriminating: true,
      run: ({ call }) =>
        attempt('result is a table of 6 rows', async () => {
          const columns = await readTable(call, 'result')
          const rows = columns[0]?.[1].length
          return rows === 6 ? undefined : `result has ${String(rows)} rows`
        }),
    },
    {
      name: 'the products are the expected ones, in order',
      discriminating: true,
      run: ({ call }) =>
        attempt('the products are the expected ones, in order', async () => {
          const columns = await readTable(call, 'result')
          return findTextColumn(columns, EXPECTED_PRODUCTS) >= 0 ? undefined : (
              `no column holds ${EXPECTED_PRODUCTS.join(', ')} (columns: ${columns.map(([n]) => n).join(', ')})`
            )
        }),
    },
    {
      name: 'a column holds the expected totals',
      discriminating: true,
      run: ({ call }) =>
        attempt('a column holds the expected totals', async () => {
          const columns = await readTable(call, 'result')
          return findNumericColumn(columns, EXPECTED_TOTALS) >= 0 ? undefined : (
              `no numeric column equals ${EXPECTED_TOTALS.join(', ')}`
            )
        }),
    },
  ],
}
