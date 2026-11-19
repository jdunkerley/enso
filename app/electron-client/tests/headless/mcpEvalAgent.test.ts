import { describe, expect, test } from 'vitest'
import {
  agentEnv,
  buildClaudeArgs,
  formatCommand,
  mcpConfig,
  PREAMBLE,
  type AgentRequest,
} from '../../mcp-eval/agent'

const request: AgentRequest = {
  prompt: 'Do the "thing".',
  model: 'sonnet',
  budgetUsd: 1.5,
  mcpConfigPath: '/tmp/mcp.json',
  maxTurns: 60,
  timeoutMs: 900_000,
}

describe('buildClaudeArgs', () => {
  const args = buildClaudeArgs(request)
  const after = (flag: string) => args[args.indexOf(flag) + 1]

  test('the prompt comes first, so the flags that take lists cannot swallow it', () => {
    expect(args.slice(0, 2)).toEqual(['-p', request.prompt])
  })
  test('only the IDE’s tools: no built-in tools, the user’s MCP servers ignored', () => {
    expect(args).toContain('--bare')
    expect(args).toContain('--strict-mcp-config')
    expect(after('--tools')).toBe('')
    expect(after('--allowedTools')).toBe('mcp__enso')
    expect(after('--mcp-config')).toBe('/tmp/mcp.json')
    expect(after('--permission-mode')).toBe('dontAsk')
    expect(after('--permission-prompts')).toBe('none')
  })
  test('budget, model, stream and no session', () => {
    expect(after('--max-budget-usd')).toBe('1.50')
    expect(after('--model')).toBe('sonnet')
    expect(after('--output-format')).toBe('stream-json')
    expect(args).toContain('--verbose')
    expect(args).toContain('--no-session-persistence')
    expect(after('--append-system-prompt')).toBe(PREAMBLE)
  })
  test('--effort only when given', () => {
    expect(args).not.toContain('--effort')
    const withEffort = buildClaudeArgs({ ...request, effort: 'high' })
    expect(withEffort[withEffort.indexOf('--effort') + 1]).toBe('high')
  })
})

describe('formatCommand', () => {
  test('quotes what a shell would need quoted, and shows the empty argument', () => {
    const text = formatCommand(['-p', 'a "b" c', '--tools', '', 'plain'])
    expect(text).toBe('claude -p "a \\"b\\" c" --tools "" plain')
  })
})

describe('mcpConfig', () => {
  test('is the IDE’s HTTP server with the run’s port and bearer token', () => {
    expect(mcpConfig(4000, 'tok')).toEqual({
      mcpServers: {
        enso: {
          type: 'http',
          url: 'http://127.0.0.1:4000/mcp',
          headers: { Authorization: 'Bearer tok' },
        },
      },
    })
  })
})

describe('agentEnv', () => {
  test('keeps where things are and the key, adds the tool timeout, and nothing else', () => {
    const env = agentEnv({
      PATH: '/bin',
      Path: undefined,
      HOME: '/home/me',
      TEMP: '/tmp',
      ANTHROPIC_API_KEY: 'sk-test',
      AWS_SECRET_ACCESS_KEY: 'nope',
      GITHUB_TOKEN: 'nope',
      ENSO_MCP_TOKEN: 'nope',
      OPENAI_API_KEY: 'nope',
    })
    expect(env).toEqual({
      PATH: '/bin',
      HOME: '/home/me',
      TEMP: '/tmp',
      ANTHROPIC_API_KEY: 'sk-test',
      MCP_TOOL_TIMEOUT: '130000',
    })
  })
  test('without a key there is none to pass', () => {
    expect(agentEnv({ PATH: '/bin' }).ANTHROPIC_API_KEY).toBeUndefined()
  })
})
