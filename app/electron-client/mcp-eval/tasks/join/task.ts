import { keyedTotalsProblem } from '../../checkHelpers'
import type { TaskDefinition } from '../../task'
import { attempt, readTable } from '../helpers'

/** The order amount per region of the customers who joined in 2024; the West has no orders. */
export const EXPECTED_TOTALS: Readonly<Record<string, number>> = {
  North: 2322.72,
  South: 2483.3,
  East: 1383.49,
  West: 0,
}

export const join: TaskDefinition = {
  id: 'join',
  summary: 'Join customers to orders and total by region, keeping a region with no orders.',
  prompt:
    'The project has two data files in `data/`: `customers.csv` (id, region, joined) and ' +
    '`orders.csv` (customer_id, amount). For the customers who joined in 2024, work out the ' +
    'total order amount per region. Every region that has such customers must be listed, ' +
    'even one whose customers have no orders. Put the final table in a node named `result`.',
  checks: [
    {
      name: 'result has 4 rows',
      discriminating: true,
      run: ({ call }) =>
        attempt('result has 4 rows', async () => {
          const rows = (await readTable(call, 'result'))[0]?.[1].length
          return rows === 4 ? undefined : `result has ${String(rows)} rows`
        }),
    },
    {
      name: 'each region’s total is the expected one',
      discriminating: true,
      run: ({ call }) =>
        attempt('each region’s total is the expected one', async () =>
          keyedTotalsProblem(await readTable(call, 'result'), EXPECTED_TOTALS),
        ),
    },
  ],
}
