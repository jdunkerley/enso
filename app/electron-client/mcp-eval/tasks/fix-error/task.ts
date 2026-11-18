import { findNumericColumn, findTextColumn } from '../../checkHelpers'
import type { TaskDefinition } from '../../task'
import { attempt, readGraph, readProblems, readTable } from '../helpers'

/** North's revenue per product over both years, largest first: what the pipeline was meant to give. */
export const EXPECTED_PRODUCTS = ['Gadget', 'Flange', 'Gizmo', 'Widget', 'Doohickey', 'Sprocket']
export const EXPECTED_TOTALS = [7756.5, 5450.25, 5272.5, 3403.25, 1625.75, 1150.5]
/** The pipeline has six nodes and its output node, and the fix must keep all of them. */
export const NODE_COUNT = 7

export const fixError: TaskDefinition = {
  id: 'fix-error',
  summary: 'Find the node in error in a 6-node pipeline and fix it.',
  prompt:
    'One node in this project is in error. Fix it so that the pipeline gives the result it was ' +
    'meant to: the total revenue of each product for the North region, largest first, in the ' +
    'node `result`. Fix the node; do not delete any.',
  checks: [
    {
      name: 'no error or panic is left',
      discriminating: true,
      run: ({ call }) =>
        attempt('no error or panic is left', async () => {
          const problems = await readProblems(call)
          const bad = problems.nodes.filter((n) => n.state === 'error' || n.state === 'panic')
          const errors = problems.diagnostics.filter((d) => d.kind === 'error')
          if (problems.pending > 0) return `${problems.pending} nodes are still computing`
          if (bad.length > 0) {
            return `in error: ${bad.map((n) => `${n.name ?? '?'} (${n.message ?? n.state})`).join('; ')}`
          }
          return errors.length > 0 ?
              `compile errors: ${errors.map((e) => e.message).join('; ')}`
            : undefined
        }),
    },
    {
      name: 'the pipeline still has its 7 nodes',
      run: ({ call }) =>
        attempt('the pipeline still has its 7 nodes', async () => {
          const count = (await readGraph(call)).nodes.length
          return count === NODE_COUNT ? undefined : `the graph has ${count} nodes`
        }),
    },
    {
      name: 'result is the reference solution’s table',
      discriminating: true,
      run: ({ call }) =>
        attempt('result is the reference solution’s table', async () => {
          const columns = await readTable(call, 'result')
          if (findTextColumn(columns, EXPECTED_PRODUCTS) < 0) {
            return `no column holds ${EXPECTED_PRODUCTS.join(', ')}`
          }
          return findNumericColumn(columns, EXPECTED_TOTALS) >= 0 ? undefined : (
              `no numeric column equals ${EXPECTED_TOTALS.join(', ')}`
            )
        }),
    },
  ],
}
