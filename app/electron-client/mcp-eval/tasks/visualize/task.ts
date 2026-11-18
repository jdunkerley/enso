/* eslint-disable camelcase -- tool argument and stream field names are snake_case on the wire */
import { findNumericColumn } from '../../checkHelpers'
import type { TaskDefinition } from '../../task'
import { MONTHLY_REVENUE } from '../data'
import { attempt, readGraph, readTable } from '../helpers'

export const visualize: TaskDefinition = {
  id: 'visualize',
  summary: 'Show a chart of revenue against month, large enough to read.',
  prompt:
    'The node `monthly` holds a table of revenue for each month of the year. Show revenue ' +
    'against month as a chart on that node, large enough to read (at least 400 units wide). ' +
    'Do not change what any node computes.',
  checks: [
    {
      name: 'monthly shows a Scatter Plot',
      discriminating: true,
      run: ({ call }) =>
        attempt('monthly shows a Scatter Plot', async () => {
          const node = (await readGraph(call)).nodes.find((n) => n.name === 'monthly')
          if (node == null) return 'there is no node named monthly'
          const reply = await call('list_visualizations', { node_id: node.id })
          if (reply.isError) return reply.text
          const about = JSON.parse(reply.text) as { shown?: boolean; visualization?: string | null }
          return about.shown === true && about.visualization === 'Scatter Plot' ?
              undefined
            : `shown ${String(about.shown)}, visualization ${String(about.visualization)}`
        }),
    },
    {
      name: 'the visualization is at least 400 wide',
      discriminating: true,
      run: ({ call }) =>
        attempt('the visualization is at least 400 wide', async () => {
          const node = (await readGraph(call)).nodes.find((n) => n.name === 'monthly')
          if (node == null) return 'there is no node named monthly'
          const reply = await call('list_visualizations', { node_id: node.id })
          if (reply.isError) return reply.text
          const width = (JSON.parse(reply.text) as { size?: { width?: number } }).size?.width
          return typeof width === 'number' && width >= 400 ?
              undefined
            : `its width is ${String(width)}`
        }),
    },
    {
      name: 'monthly still holds the same table',
      run: ({ call }) =>
        attempt('monthly still holds the same table', async () => {
          const columns = await readTable(call, 'monthly')
          const ok =
            findNumericColumn(
              columns,
              MONTHLY_REVENUE.map(([m]) => m),
            ) >= 0 &&
            findNumericColumn(
              columns,
              MONTHLY_REVENUE.map(([, r]) => r),
            ) >= 0
          return ok ? undefined : 'the months or revenues changed'
        }),
    },
  ],
}
