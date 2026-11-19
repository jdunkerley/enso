/**
 * @file Reads Claude Code's `--output-format stream-json` stream: counts turns, tool calls, tool
 * errors and refusals as lines arrive (so the runner can stop at the turn cap), and reads the
 * final `result` message (cost, tokens, duration).
 */

/** The IDE's own refusals, by their stable texts (the MCP server's tool descriptions state them). */
export const IDE_REFUSALS: readonly { readonly kind: string; readonly pattern: RegExp }[] = [
  { kind: 'live', pattern: /The project is in Live mode/ },
  { kind: 'write', pattern: /Only the user can turn Write on/ },
  { kind: 'tooLate', pattern: /The call timed out before it ran/ },
  { kind: 'otherMethod', pattern: /The method on screen changed before this edit ran/ },
  { kind: 'outsideDrive', pattern: /That folder is outside the Drive/ },
]

export interface Tokens {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheCreation: number
}

export interface AgentResult {
  readonly subtype: string
  readonly isError: boolean
  readonly totalCostUsd: number
  readonly durationMs: number
  readonly durationApiMs: number
  readonly numTurns: number | undefined
  readonly tokens: Tokens
  readonly permissionDenials: number
  readonly text: string
}

export interface StreamSummary {
  readonly turns: number
  readonly toolCalls: number
  readonly toolCallsByName: Readonly<Record<string, number>>
  readonly toolErrors: number
  /** Refusals by kind: the IDE's (`live`, `write`, …), `permissionDenied` and `modelRefusal`. */
  readonly refusals: Readonly<Record<string, number>>
  readonly result: AgentResult | undefined
  /** Lines that were not JSON (the stream should have none). */
  readonly malformedLines: number
}

type Json = Record<string, unknown>

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value != null && !Array.isArray(value)
const num = (value: unknown): number => (typeof value === 'number' ? value : 0)

/** The text of a `tool_result` block's content (a string, or a list of text items). */
function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((item) => (isObject(item) && typeof item.text === 'string' ? item.text : ''))
      .join('\n')
  }
  return ''
}

/** The tool's name without the server prefix: `mcp__enso__get_graph` is `get_graph`. */
export function toolName(name: string): string {
  if (!name.startsWith('mcp__')) return name
  return name.split('__').slice(2).join('__') || name
}

/**
 * A running tally of the stream. A turn is one model response: the CLI may write one `assistant`
 * line per content block of a response, all with the same message id, so turns are counted by id
 * (a line with no id counts as its own turn).
 */
export class StreamTally {
  private readonly messageIds = new Set<string>()
  private anonymousTurns = 0
  private toolCalls = 0
  private readonly byName: Record<string, number> = {}
  private readonly toolUses = new Set<string>()
  private toolErrors = 0
  private readonly refusals: Record<string, number> = {}
  private result: AgentResult | undefined
  private malformed = 0

  /** The model responses seen so far. */
  get turns(): number {
    return this.messageIds.size + this.anonymousTurns
  }

  /** Reads one line of the stream; returns the turns so far. */
  push(line: string): number {
    const trimmed = line.trim()
    if (trimmed === '') return this.turns
    let message: unknown
    try {
      message = JSON.parse(trimmed)
    } catch {
      this.malformed += 1
      return this.turns
    }
    if (!isObject(message)) return this.turns
    switch (message.type) {
      case 'assistant':
        this.assistant(message)
        break
      case 'user':
        this.user(message)
        break
      case 'result':
        this.finish(message)
        break
    }
    return this.turns
  }

  private count(kind: string) {
    this.refusals[kind] = (this.refusals[kind] ?? 0) + 1
  }

  private assistant(line: Json) {
    const message = line.message
    if (!isObject(message)) return
    if (typeof message.id === 'string') this.messageIds.add(message.id)
    else this.anonymousTurns += 1
    if (message.stop_reason === 'refusal') this.count('modelRefusal')
    if (!Array.isArray(message.content)) return
    for (const block of message.content) {
      if (!isObject(block) || block.type !== 'tool_use') continue
      // A block repeated in a later line of the same response is one call.
      const id = typeof block.id === 'string' ? block.id : undefined
      if (id != null) {
        if (this.toolUses.has(id)) continue
        this.toolUses.add(id)
      }
      this.toolCalls += 1
      const name = toolName(typeof block.name === 'string' ? block.name : 'unknown')
      this.byName[name] = (this.byName[name] ?? 0) + 1
    }
  }

  private user(line: Json) {
    const message = line.message
    if (!isObject(message) || !Array.isArray(message.content)) return
    for (const block of message.content) {
      if (!isObject(block) || block.type !== 'tool_result' || block.is_error !== true) continue
      this.toolErrors += 1
      const text = resultText(block.content)
      for (const { kind, pattern } of IDE_REFUSALS) {
        if (pattern.test(text)) this.count(kind)
      }
    }
  }

  private finish(line: Json) {
    const usage = isObject(line.usage) ? line.usage : {}
    const denials = Array.isArray(line.permission_denials) ? line.permission_denials.length : 0
    if (denials > 0) this.refusals.permissionDenied = denials
    this.result = {
      subtype: typeof line.subtype === 'string' ? line.subtype : 'unknown',
      isError: line.is_error === true,
      totalCostUsd: num(line.total_cost_usd),
      durationMs: num(line.duration_ms),
      durationApiMs: num(line.duration_api_ms),
      numTurns: typeof line.num_turns === 'number' ? line.num_turns : undefined,
      tokens: {
        input: num(usage.input_tokens),
        output: num(usage.output_tokens),
        cacheRead: num(usage.cache_read_input_tokens),
        cacheCreation: num(usage.cache_creation_input_tokens),
      },
      permissionDenials: denials,
      text: typeof line.result === 'string' ? line.result : '',
    }
  }

  /** Everything counted so far, and the final result when it has arrived. */
  summary(): StreamSummary {
    return {
      turns: this.turns,
      toolCalls: this.toolCalls,
      toolCallsByName: { ...this.byName },
      toolErrors: this.toolErrors,
      refusals: { ...this.refusals },
      result: this.result,
      malformedLines: this.malformed,
    }
  }
}

/** The summary of a whole recorded stream. */
export function summariseStream(text: string): StreamSummary {
  const tally = new StreamTally()
  for (const line of text.split('\n')) tally.push(line)
  return tally.summary()
}

/** How a task run ended, from the stream and what the runner enforced. */
export type Ended = 'done' | 'turn-cap' | 'timeout' | 'budget' | 'error'

/** `done` only for a result that is not an error; the budget and error subtypes are named. */
export function endedFromResult(result: AgentResult | undefined): Ended {
  if (result == null) return 'error'
  if (result.subtype === 'error_max_budget_usd') return 'budget'
  if (result.isError || result.subtype !== 'success') return 'error'
  return 'done'
}
