/**
 * @file What a task is, and what a check may use. A check reads the project through the IDE's MCP
 * tools only (never edits); the judging is objective, none of it by a model.
 */
import type { Ended } from './stream'

export interface ToolReply {
  readonly isError: boolean
  readonly text: string
}

/** Calls one of the IDE's MCP tools. */
export type CallTool = (name: string, args?: Record<string, unknown>) => Promise<ToolReply>

export interface CheckResult {
  readonly name: string
  readonly passed: boolean
  readonly detail?: string
}

/** What the runner knows about the project and the run when it checks. */
export interface CheckContext {
  readonly call: CallTool
  /** The project's `src/Main.enso` on disk now (the IDE saves edits a few seconds after a call). */
  readonly mainSource: string
  /** What {@link TaskDefinition.baseline} read from the starting project, before the agent. */
  readonly baseline: Readonly<Record<string, unknown>>
}

export interface Check {
  readonly name: string
  /**
   * Whether the untouched starting project must fail this check (`--self-check` demands it). A
   * check that holds before the agent does anything (a node count that must not change) is not.
   */
  readonly discriminating?: boolean
  run(context: CheckContext): Promise<CheckResult>
}

export interface TaskDefinition {
  readonly id: string
  /** One line for the report. */
  readonly summary: string
  /** What the agent is asked; names the final node but never the components to use. */
  readonly prompt: string
  /** Reads what a check compares with from the starting project, once it is open and settled. */
  baseline?(call: CallTool): Promise<Record<string, unknown>>
  readonly checks: readonly Check[]
}

/** What a task run's common checks need. */
export interface RunFacts {
  readonly ended: Ended | 'self-check'
  /** Files changed, added or removed since the project was open, outside what an agent may touch. */
  readonly forbiddenFileChanges: readonly string[]
  /** Dry-run files found in the project or the agent's directory. */
  readonly dryRunFiles: readonly string[]
}

export const passed = (name: string, detail?: string): CheckResult => ({
  name,
  passed: true,
  ...(detail != null ? { detail } : {}),
})
export const failed = (name: string, detail: string): CheckResult => ({
  name,
  passed: false,
  detail,
})

/** The checks every task has (spec, "The tasks"). */
export function commonChecks(facts: RunFacts): CheckResult[] {
  return [
    facts.ended === 'done' || facts.ended === 'self-check' ?
      passed('ended by itself')
    : failed('ended by itself', `the run ended with: ${facts.ended}`),
    facts.forbiddenFileChanges.length === 0 ?
      passed('no file changed but Main.enso and images')
    : failed(
        'no file changed but Main.enso and images',
        `touched: ${facts.forbiddenFileChanges.join(', ')}`,
      ),
    facts.dryRunFiles.length === 0 ?
      passed('no dry-run file outside the system temporary directory')
    : failed(
        'no dry-run file outside the system temporary directory',
        `found: ${facts.dryRunFiles.join(', ')}`,
      ),
  ]
}
