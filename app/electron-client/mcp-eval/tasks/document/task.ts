/* eslint-disable camelcase -- tool argument and stream field names are snake_case on the wire */
import { nodeNamed, stripDocumentation } from '../../checkHelpers'
import type { CallTool, TaskDefinition } from '../../task'
import { attempt, backToMain, readGraph } from '../helpers'
import { DOCUMENT_PROJECT } from '../sources'

/** The documentation of the function on screen. */
async function documentation(call: CallTool): Promise<string> {
  const reply = await call('get_documentation')
  if (reply.isError) throw new Error(`get_documentation failed: ${reply.text}`)
  return (JSON.parse(reply.text) as { text?: string }).text ?? ''
}

/** The documentation of `clean_names`: opens the method of the node that calls it. */
async function cleanNamesDocumentation(call: CallTool): Promise<string> {
  await backToMain(call)
  const graph = await readGraph(call)
  const caller = graph.nodes.find((n) => /Main\.clean_names\b/.test(n.code))
  if (caller == null) throw new Error('no node calls Main.clean_names any more')
  const opened = await call('open_method', { node_id: caller.id })
  if (opened.isError) throw new Error(`open_method failed: ${opened.text}`)
  return await documentation(call)
}

export const document: TaskDefinition = {
  id: 'document',
  summary: 'Document a workflow and one of its functions, in the standard library’s style.',
  prompt:
    'Write documentation for this project: for the workflow itself (the `main` function) and for ' +
    'the function `clean_names`. Use the style of Enso’s standard library: a one-sentence ' +
    'summary first, then an `## Arguments` section that lists each argument as a bullet, then an ' +
    '`## Examples` section with a short example in a code fence. Do not change any code.',
  checks: [
    {
      name: 'the workflow has documentation',
      discriminating: true,
      run: ({ call }) =>
        attempt('the workflow has documentation', async () => {
          await backToMain(call)
          return (await documentation(call)).trim() === '' ? 'it is empty' : undefined
        }),
    },
    {
      name: 'clean_names has documentation that names its argument',
      discriminating: true,
      run: ({ call }) =>
        attempt('clean_names has documentation that names its argument', async () => {
          const text = await cleanNamesDocumentation(call)
          if (text.trim() === '') return 'it is empty'
          return /\btext\b/.test(text) ? undefined : 'it does not mention `text`'
        }),
    },
    {
      name: 'clean_names has an Examples section with a code fence',
      discriminating: true,
      run: ({ call }) =>
        attempt('clean_names has an Examples section with a code fence', async () => {
          const text = await cleanNamesDocumentation(call)
          if (!/^\s*#{1,4}\s*Examples?\b/im.test(text)) return 'no Examples heading'
          return /```/.test(text) ? undefined : 'no code fence'
        }),
    },
    {
      name: 'the code is unchanged',
      run: ({ mainSource }) =>
        attempt('the code is unchanged', async () => {
          const before = stripDocumentation(DOCUMENT_PROJECT)
          const after = stripDocumentation(mainSource)
          return before === after ? undefined : `the code changed:\n${after}`
        }),
    },
    {
      name: 'the graph still has its nodes',
      run: ({ call }) =>
        attempt('the graph still has its nodes', async () => {
          await backToMain(call)
          const graph = await readGraph(call)
          return ['raw', 'first_name', 'cleaned', 'summary'].every((n) => nodeNamed(graph, n)) ?
              undefined
            : `nodes: ${graph.nodes.map((n) => n.name ?? '?').join(', ')}`
        }),
    },
  ],
}
