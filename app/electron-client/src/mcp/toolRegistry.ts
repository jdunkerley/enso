/** @file The registry of every tool the IDE's MCP server offers, and the validation in front of them. */
import type { McpCaller, McpToolResult } from 'enso-common/src/mcp'
import { z, type ZodRawShape } from 'zod'

export interface ToolDefinition {
  readonly name: string
  readonly title: string
  readonly description: string
  readonly inputSchema: ZodRawShape
  /** Runs in main. `args` has passed `inputSchema`. */
  readonly run: (args: Record<string, unknown>, caller: McpCaller) => Promise<McpToolResult>
}

/** Holds the tool definitions and runs them after validating their arguments. */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>()

  /** Add a tool. Throws if a tool of that name is already registered. */
  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) throw new Error(`Tool '${tool.name}' is already registered`)
    this.tools.set(tool.name, tool)
  }

  /** The registered tools, in registration order. */
  list(): readonly ToolDefinition[] {
    return [...this.tools.values()]
  }

  /**
   * Validate `args` against the tool's schema (strictly: unknown keys are refused) and run it.
   * Never throws: an unknown tool, invalid arguments or a throwing `run` give `{ ok: false }`.
   */
  async call(name: string, args: unknown, caller: McpCaller): Promise<McpToolResult> {
    const tool = this.tools.get(name)
    if (tool == null) return { ok: false, error: `Unknown tool '${name}'` }
    const parsed = z.object(tool.inputSchema).strict().safeParse(args)
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ')
      return { ok: false, error: `Invalid arguments for '${name}': ${issues}` }
    }
    try {
      return await tool.run(parsed.data, caller)
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }
}
