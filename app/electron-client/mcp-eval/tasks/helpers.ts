/* eslint-disable camelcase -- tool argument and stream field names are snake_case on the wire */
/**
 * @file What the tasks' checks share: reading the graph and values through the IDE's MCP tools.
 */
import {
  COLUMNS_EXPRESSION,
  nodeNamed,
  parseColumns,
  parseGraph,
  type Columns,
  type Graph,
} from '../checkHelpers'
import { failed, passed, type CallTool, type CheckResult } from '../task'

/** The graph of the method on screen, optionally with positions and areas. */
export async function readGraph(call: CallTool, layout = false): Promise<Graph> {
  const reply = await call(
    'get_graph',
    layout ? { layout: true, previews: false } : { previews: false },
  )
  if (reply.isError) throw new Error(`get_graph failed: ${reply.text}`)
  return parseGraph(reply.text)
}

/** Evaluates `expression` (which must give Text) in the scope of the node named `scope`. */
export async function evaluate(call: CallTool, expression: string, scope: string): Promise<string> {
  const graph = await readGraph(call)
  const node = nodeNamed(graph, scope)
  if (node == null) throw new Error(`there is no node named ${scope}`)
  const guarded = `((${expression}).catch Any (e -> e.to_display_text))`
  const reply = await call('evaluate_expression', { expression: guarded, node_id: node.id })
  if (reply.isError) throw new Error(`evaluate_expression failed: ${reply.text}`)
  return reply.text
}

/** The table the node `name` holds, as columns. Throws with the reason when it is not one. */
export async function readTable(call: CallTool, name: string): Promise<Columns> {
  return parseColumns(await evaluate(call, COLUMNS_EXPRESSION(name), name))
}

/** Runs `body`, turning a throw into a failed check named `name`. */
export async function attempt(
  name: string,
  body: () => Promise<string | undefined>,
): Promise<CheckResult> {
  try {
    const problem = await body()
    return problem == null ? passed(name) : failed(name, problem)
  } catch (e) {
    return failed(name, e instanceof Error ? e.message : String(e))
  }
}

/** Waits until `get_problems` says nothing is pending (at most `timeoutMs`), then returns it. */
export async function readProblems(
  call: CallTool,
  timeoutMs = 60_000,
): Promise<{
  nodes: { name: string | null; state: string; message: string | null }[]
  diagnostics: { kind: string; message: string }[]
  pending: number
}> {
  const end = Date.now() + timeoutMs
  for (;;) {
    const reply = await call('get_problems')
    if (reply.isError) throw new Error(`get_problems failed: ${reply.text}`)
    const value = JSON.parse(reply.text) as {
      nodes?: { name: string | null; state: string; message: string | null }[]
      diagnostics?: { kind: string; message: string }[]
      pending?: number
    }
    const pending = value.pending ?? 0
    if (pending === 0 || Date.now() > end) {
      return { nodes: value.nodes ?? [], diagnostics: value.diagnostics ?? [], pending }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
}

/** Goes back to `main` when the agent left a function open (`open_method` without a node). */
export async function backToMain(call: CallTool): Promise<void> {
  for (let i = 0; i < 6; i++) {
    const graph = await readGraph(call)
    if (/(^|\.)main$/.test(graph.method)) return
    const reply = await call('open_method', {})
    if (reply.isError) throw new Error(`open_method (back) failed: ${reply.text}`)
  }
  throw new Error('could not get back to main')
}
