/**
 * @file The `get_problems` MCP tool: every error and warning of the method on screen, and the
 * module's compile diagnostics that concern it, in one call. Pure functions over
 * {@link ProblemToolDeps}, which `useProjectMcpTools` builds from the open project's stores at call
 * time. It reads only: no evaluation, no edit, and it works in Live mode.
 */
/* eslint-disable camelcase -- result field names are snake_case on the wire */
import type { GraphDb, NodeId } from '$/providers/openedProjects/graph/graphDatabase'
import type { Ast } from '@/util/ast'
import type { MethodPointer } from '@/util/methodPointer'
import type { McpToolResult } from 'enso-common/src/mcp'
import type { Result } from 'enso-common/src/utilities/data/result'
import { watch } from 'vue'
import type { Diagnostic, Path } from 'ydoc-shared/languageServerTypes'
import type { SourceRange } from 'ydoc-shared/util/data/text'
import type { ExternalId } from 'ydoc-shared/yjsModel'
import { GRAPH_NODE_TEXT_CHARS, jsonResult, truncate } from './graphTools'

/** Most nodes `get_problems` lists; errors and panics are kept before warnings. */
export const PROBLEM_NODES_MAX = 100
/** Most compile diagnostics `get_problems` lists. */
export const PROBLEM_DIAGNOSTICS_MAX = 50
/**
 * How long, from the first lookup, `get_problems` waits for the text of the dataflow errors: it
 * loads on first lookup, by a small visualization that has to run in the engine.
 */
export const PROBLEM_TEXT_WAIT_MS = 5_000

/** What `get_problems` reads. */
export interface ProblemToolDeps {
  /** The graph of the method on screen; its nodes are listed in this database's order. */
  readonly db: GraphDb
  readonly currentMethod: {
    ast: Result<Ast.FunctionDef>
    pointer: Result<MethodPointer>
  }
  /**
   * The text of a dataflow error (`projectStore.dataflowErrors.lookup(id)?.value?.message`):
   * undefined until the data of its small visualization arrives, and a lookup starts that
   * visualization. It must read reactive state, so that the wait is told when the text arrives.
   */
  readonly dataflowErrorMessage: (id: ExternalId) => string | undefined
  /** The module's compile diagnostics, as the execution context last reported them. */
  readonly diagnostics: () => readonly Diagnostic[]
  /** The method on screen's span in the module's text; undefined when not known. */
  readonly methodRange: () => SourceRange | undefined
  /** The span in the module's text of the expression with this external id, when it has one. */
  readonly expressionRange: (id: ExternalId) => SourceRange | undefined
  /** The 1-based line of the module's text that this offset is on. */
  readonly lineOf: (offset: number) => number
  /** Whether a diagnostic's file is the module on screen (always true for no path). */
  readonly isThisModule: (path: Path | undefined) => boolean
  /** The longest wait for error texts, in milliseconds; {@link PROBLEM_TEXT_WAIT_MS} by default. */
  readonly waitMs?: number
}

type ProblemState = 'panic' | 'error' | 'warning'

interface ProblemNode {
  readonly id: NodeId
  readonly index: number
  readonly name: string | null
  readonly state: ProblemState
  /** A panic's message or a warning's text; undefined for a dataflow error, whose text is read. */
  readonly text: string | undefined
  readonly warnings?: number
}

/**
 * The error text a node shows: the part before ` (at …`, as `nodeMessage.ts` cuts it.
 */
function visibleErrorText(raw: string): string {
  return raw.split(' (at')[0]!
}

/**
 * Resolves once every id has a text, or after `waitMs`. The lookups all start at once (the first
 * read of each), and a Vue watcher over them is told when one arrives. The watcher is stopped, and
 * the timer cleared, on every path.
 */
function waitForTexts(
  ids: readonly ExternalId[],
  read: (id: ExternalId) => string | undefined,
  waitMs: number,
): Promise<void> {
  if (ids.length === 0) return Promise.resolve()
  return new Promise((resolve) => {
    let done = false
    const watcher: { stop?: () => void } = {}
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      watcher.stop?.()
      resolve()
    }
    const timer = setTimeout(finish, waitMs)
    // Every lookup is started here, before the watcher reads them one by one.
    for (const id of ids) read(id)
    watcher.stop = watch(
      () => ids.every((id) => read(id) != null),
      (all) => {
        if (all) finish()
      },
      { flush: 'sync', immediate: true },
    )
    // `immediate` may have finished before the watcher's stop function existed.
    if (done) watcher.stop()
  })
}

/**
 * `get_problems`: the nodes of the method on screen that are a panic, a dataflow error or a value
 * with warnings (at most {@link PROBLEM_NODES_MAX}: errors and panics first, then warnings, listed
 * in the order of `get_graph`), the module's compile diagnostics that lie inside the method or
 * have no position (at most {@link PROBLEM_DIAGNOSTICS_MAX}), the counts, and how many nodes are
 * still computing.
 *
 * The text of a dataflow error is loaded by a small visualization on first lookup: it is waited for
 * for at most `waitMs`; a node whose text did not arrive has `message: null` and no `origin`, and
 * `messages_pending` counts those.
 *
 * `origin` (errors and panics only) is false when a node this one takes input from has the same
 * full message, true otherwise: the fix is at the nodes with `origin: true`.
 */
export async function getProblems(deps: ProblemToolDeps): Promise<McpToolResult> {
  const { ast, pointer } = deps.currentMethod
  if (!ast.ok) return { ok: false, error: ast.error.message('') }
  if (!pointer.ok) return { ok: false, error: pointer.error.message('') }

  const problems: ProblemNode[] = []
  let pending = 0
  let index = 0
  for (const [id, node] of deps.db.nodeIdToNode) {
    const payload = deps.db.getExpressionInfo(id)?.payload
    const name = node.pattern?.code() ?? null
    switch (payload?.type) {
      case 'Pending':
        pending++
        break
      case 'Panic':
        problems.push({ id, index, name, state: 'panic', text: payload.message })
        break
      case 'DataflowError':
        problems.push({ id, index, name, state: 'error', text: undefined })
        break
      case 'Value':
        if (payload.warnings != null && payload.warnings.count > 0) {
          problems.push({
            id,
            index,
            name,
            state: 'warning',
            text: payload.warnings.value,
            warnings: payload.warnings.count,
          })
        }
        break
    }
    index++
  }
  const errors = problems.filter((p) => p.state !== 'warning').length
  const warnings = problems.length - errors
  const ordered = [
    ...problems.filter((p) => p.state !== 'warning'),
    ...problems.filter((p) => p.state === 'warning'),
  ]
  const kept = ordered.slice(0, PROBLEM_NODES_MAX).sort((a, b) => a.index - b.index)

  const inputsOf = (id: NodeId): NodeId[] => [...deps.db.nodeDependents.reverseLookup(id)]
  const inputPanicText = (id: NodeId): string | undefined => {
    const payload = deps.db.getExpressionInfo(id)?.payload
    return payload?.type === 'Panic' ? payload.message : undefined
  }
  // The texts to wait for: those of the dataflow errors listed, and of their inputs, which the
  // `origin` comparison reads.
  const wanted = new Set<ExternalId>()
  for (const problem of kept) {
    if (problem.state !== 'error') continue
    wanted.add(problem.id)
    for (const input of inputsOf(problem.id)) {
      if (deps.db.getExpressionInfo(input)?.payload.type === 'DataflowError') wanted.add(input)
    }
  }
  await waitForTexts([...wanted], deps.dataflowErrorMessage, deps.waitMs ?? PROBLEM_TEXT_WAIT_MS)

  let messagesPending = 0
  const nodes = kept.map((problem) => {
    const base = { id: problem.id, name: problem.name, state: problem.state }
    if (problem.state === 'warning') {
      return {
        ...base,
        message: truncateText(problem.text),
        warnings: problem.warnings,
      }
    }
    if (problem.state === 'panic') {
      const origin = !inputsOf(problem.id).some((input) => inputPanicText(input) === problem.text)
      return { ...base, message: truncateText(problem.text), origin }
    }
    const raw = deps.dataflowErrorMessage(problem.id)
    if (raw == null) {
      messagesPending++
      return { ...base, message: null }
    }
    const origin = !inputsOf(problem.id).some((input) => deps.dataflowErrorMessage(input) === raw)
    return { ...base, message: truncateText(visibleErrorText(raw)), origin }
  })

  const { listed, truncated: diagnosticsTruncated } = listDiagnostics(deps)
  return jsonResult({
    method: pointer.value.name,
    nodes,
    diagnostics: listed,
    errors,
    warnings,
    pending,
    truncated: problems.length > kept.length,
    ...(messagesPending > 0 ? { messages_pending: messagesPending } : {}),
    ...(diagnosticsTruncated ? { diagnostics_truncated: true } : {}),
  })
}

function truncateText(text: string | undefined): string | null {
  return text == null ? null : truncate(text, GRAPH_NODE_TEXT_CHARS)
}

interface ListedDiagnostic {
  kind: 'error' | 'warning'
  message: string
  line?: number
}

/**
 * The diagnostics of the module on screen that concern the method on screen, or have no position.
 * A diagnostic with an expression id is placed by that expression's span; one the module no longer
 * has, or one with only a `location` (0-based lines in the file), by its line. Both are inside the
 * method when their line is within the method's lines.
 */
function listDiagnostics(deps: ProblemToolDeps): {
  listed: ListedDiagnostic[]
  truncated: boolean
} {
  const method = deps.methodRange()
  const firstLine = method != null ? deps.lineOf(method.from) : undefined
  const lastLine = method != null ? deps.lineOf(method.to) : undefined
  const within = (line: number) =>
    firstLine != null && lastLine != null && line >= firstLine && line <= lastLine
  const listed: ListedDiagnostic[] = []
  let truncated = false
  for (const diagnostic of deps.diagnostics()) {
    if (!deps.isThisModule(diagnostic.path)) continue
    const span =
      diagnostic.expressionId != null ? deps.expressionRange(diagnostic.expressionId) : undefined
    let line: number | undefined
    if (span != null) line = deps.lineOf(span.from)
    else if (diagnostic.location != null) line = diagnostic.location.start.line + 1
    if (line != null && !within(line)) continue
    if (listed.length >= PROBLEM_DIAGNOSTICS_MAX) {
      truncated = true
      break
    }
    listed.push({
      kind: diagnostic.kind === 'Error' ? 'error' : 'warning',
      message: truncate(diagnostic.message, GRAPH_NODE_TEXT_CHARS),
      ...(line != null ? { line } : {}),
    })
  }
  return { listed, truncated }
}
