import { edgesNotDownward, overlappingPairs, stripDocumentation } from '../../checkHelpers'
import type { TaskDefinition } from '../../task'
import { attempt, readGraph } from '../helpers'
import { LAYOUT_MAIN, LAYOUT_NODES } from '../sources'

export const layout: TaskDefinition = {
  id: 'layout',
  summary: 'Lay out 12 connected nodes that were stored on top of each other.',
  prompt:
    'The graph of this project is hard to read: its nodes sit on top of each other. Lay it out ' +
    'so that it reads in the order of the data flow, with no node covering another. Do not ' +
    'change what any node computes.',
  checks: [
    {
      name: 'all 12 nodes are drawn',
      discriminating: false,
      run: ({ call }) =>
        attempt('all 12 nodes are drawn', async () => {
          const graph = await readGraph(call, true)
          const drawn = graph.nodes.filter((n) => n.area != null && n.position != null)
          return LAYOUT_NODES.every((name) => drawn.some((n) => n.name === name)) ? undefined : (
              `drawn: ${drawn.map((n) => n.name ?? '?').join(', ')}`
            )
        }),
    },
    {
      name: 'no two nodes overlap',
      discriminating: true,
      run: ({ call }) =>
        attempt('no two nodes overlap', async () => {
          const pairs = overlappingPairs((await readGraph(call, true)).nodes)
          return pairs.length === 0 ?
              undefined
            : `${pairs.length} overlapping pairs, e.g. ${pairs
                .slice(0, 4)
                .map((p) => p.join('/'))
                .join(', ')}`
        }),
    },
    {
      name: 'every node is below its inputs',
      discriminating: true,
      run: ({ call }) =>
        attempt('every node is below its inputs', async () => {
          const bad = edgesNotDownward((await readGraph(call, true)).nodes)
          return bad.length === 0 ?
              undefined
            : `not below their input: ${bad
                .slice(0, 6)
                .map(([a, b]) => `${a} -> ${b}`)
                .join(', ')}`
        }),
    },
    {
      name: 'the code is unchanged',
      run: ({ mainSource }) =>
        attempt('the code is unchanged', async () => {
          const after = stripDocumentation(mainSource)
          return after === stripDocumentation(LAYOUT_MAIN) ? undefined : (
              `the code changed:\n${after}`
            )
        }),
    },
  ],
}
