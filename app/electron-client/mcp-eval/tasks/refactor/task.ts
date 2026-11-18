import { COLUMNS_EXPRESSION } from '../../checkHelpers'
import type { TaskDefinition } from '../../task'
import { attempt, evaluate, readGraph } from '../helpers'

export const refactor: TaskDefinition = {
  id: 'refactor',
  summary: 'Group four cleaning nodes into a function and comment its call.',
  prompt:
    'In this project the four nodes from `trimmed` to `cleaned` clean up the table `raw`, and ' +
    'the nodes after them summarise it. Group the four cleaning steps into a function named ' +
    '`clean` that the graph calls, and say what it does in a comment on the node that calls ' +
    'it. The result must stay exactly the same.',
  async baseline(call) {
    const graph = await readGraph(call)
    return {
      nodeCount: graph.nodes.length,
      result: await evaluate(call, COLUMNS_EXPRESSION('result'), 'result'),
    }
  },
  checks: [
    {
      name: 'the module has a function clean',
      discriminating: true,
      run: ({ mainSource }) =>
        attempt('the module has a function clean', async () =>
          /^clean\b[^\n]*=\s*$/m.test(mainSource) ? undefined : 'no top-level `clean … =`',
        ),
    },
    {
      name: 'a node calls clean',
      discriminating: true,
      run: ({ call }) =>
        attempt('a node calls clean', async () => {
          const graph = await readGraph(call)
          return graph.nodes.some((n) => /(^|[^\w])clean\b(?!_)/.test(n.code)) ?
              undefined
            : 'no node calls it'
        }),
    },
    {
      name: 'the call node has a comment',
      discriminating: true,
      run: ({ call }) =>
        attempt('the call node has a comment', async () => {
          const graph = await readGraph(call)
          const caller = graph.nodes.find((n) => /(^|[^\w])clean\b(?!_)/.test(n.code))
          if (caller == null) return 'no node calls clean'
          return (caller.comment ?? '').trim() === '' ? 'the node has no comment' : undefined
        }),
    },
    {
      name: 'result is unchanged',
      run: ({ call, baseline }) =>
        attempt('result is unchanged', async () => {
          const now = await evaluate(call, COLUMNS_EXPRESSION('result'), 'result')
          return now === baseline.result ? undefined : `result is now ${now}`
        }),
    },
    {
      name: 'the graph has at least 3 fewer nodes',
      discriminating: true,
      run: ({ call, baseline }) =>
        attempt('the graph has at least 3 fewer nodes', async () => {
          const count = (await readGraph(call)).nodes.length
          const before = Number(baseline.nodeCount)
          return count <= before - 3 ? undefined : `it had ${before} nodes and has ${count}`
        }),
    },
  ],
}
