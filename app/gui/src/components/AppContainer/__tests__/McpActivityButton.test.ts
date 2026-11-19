/**
 * @file The MCP activity icon and its popover (#864): the state each combination of main's status
 * and activity record gives, the Enable button, the lapse of the active and connected states, and
 * what the popover never shows.
 */
import { useText } from '$/providers/text'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import {
  MCP_DEFAULT_PORT,
  type McpActivityCall,
  type McpActivitySnapshot,
  type McpStatus,
} from 'enso-common/src/mcp'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import McpActivityButton from '../McpActivityButton.vue'

const fake = vi.hoisted(() => ({
  status: vi.fn(),
  activity: vi.fn(),
  setEnabled: vi.fn(),
  onStatusChanged: vi.fn(),
  onActivityChanged: vi.fn(),
  emitStatus: undefined as ((status: McpStatus) => void) | undefined,
  emitActivity: undefined as ((activity: McpActivitySnapshot) => void) | undefined,
}))

const { getText } = useText()

const T0 = Date.UTC(2026, 10, 18, 12, 0, 0)

const OFF: McpStatus = {
  enabled: false,
  port: MCP_DEFAULT_PORT,
  running: false,
  error: null,
  lockedByEnvironment: false,
}
const ON: McpStatus = { ...OFF, enabled: true, running: true }
const NOTHING: McpActivitySnapshot = { clients: [], calls: [] }

function call(
  id: number,
  tool: string,
  outcome: McpActivityCall['outcome'],
  endedAgoMs: number | null = outcome === 'running' ? null : 1000,
): McpActivityCall {
  return {
    id,
    client: 'Claude Code',
    tool,
    startedAt: T0 - (endedAgoMs ?? 0) - 500,
    endedAt: endedAgoMs == null ? null : T0 - endedAgoMs,
    outcome,
  }
}

function client(lastSeenAgoMs: number) {
  return { name: 'Claude Code', version: '2.0.14', lastSeenAt: T0 - lastSeenAgoMs }
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'],
  })
  vi.setSystemTime(T0)
  fake.status.mockResolvedValue(OFF)
  fake.activity.mockResolvedValue(NOTHING)
  fake.setEnabled.mockResolvedValue(ON)
  fake.onStatusChanged.mockImplementation((handler: (status: McpStatus) => void) => {
    fake.emitStatus = handler
    return () => {}
  })
  fake.onActivityChanged.mockImplementation((handler: (a: McpActivitySnapshot) => void) => {
    fake.emitActivity = handler
    return () => {}
  })
  vi.stubGlobal('api', {
    ...window.api,
    mcp: {
      status: fake.status,
      activity: fake.activity,
      setEnabled: fake.setEnabled,
      onStatusChanged: fake.onStatusChanged,
      onActivityChanged: fake.onActivityChanged,
    },
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

async function mountButton(status: McpStatus, activity: McpActivitySnapshot = NOTHING) {
  fake.status.mockResolvedValue(status)
  fake.activity.mockResolvedValue(activity)
  const mounted = mountWithProviders(McpActivityButton)
  await flushPromises()
  return mounted
}

const button = () =>
  document.querySelector<HTMLButtonElement>('[data-testid="mcp-activity-button"]')
const popover = () => document.querySelector('[data-testid="mcp-activity-content"]')
const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
const user = () => userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) })

async function openPopover() {
  await user().click(button()!)
  await flushPromises()
}

async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms)
  await flushPromises()
}

describe('without the desktop app', () => {
  test('renders nothing', () => {
    vi.stubGlobal('api', { ...window.api, mcp: undefined })
    mountWithProviders(McpActivityButton)
    expect(button()).toBeNull()
  })
})

describe('the icon', () => {
  test('is a rail button, labelled with its state while the rail is extended', async () => {
    fake.status.mockResolvedValue(ON)
    await mountWithProviders(McpActivityButton)
    await mountWithProviders(McpActivityButton, { props: { extended: true } })
    await flushPromises()
    const [collapsed, extended] = [
      ...document.querySelectorAll('[data-testid="mcp-activity-button"]'),
    ].slice(-2)
    expect(collapsed?.textContent.trim()).toBe('')
    expect(extended?.textContent.trim()).toBe(getText('mcpActivityNameIdle'))
  })

  test('is off, with no badge, when MCP is off', async () => {
    await mountButton(OFF)
    expect(button()?.getAttribute('aria-label')).toBe(getText('mcpActivityNameOff'))
    expect(button()?.dataset.stateName).toBe('off')
    expect(button()?.querySelector('.badge')).toBeNull()
  })

  test('is a problem, with a badge, when there is an error, whether on or off', async () => {
    await mountButton({ ...OFF, error: 'The MCP settings file could not be read: oops' })
    expect(button()?.getAttribute('aria-label')).toBe(getText('mcpActivityNameProblem'))
    expect(button()?.querySelector('.badge')?.textContent).toBe('!')
  })

  test('error wins over a connected client', async () => {
    await mountButton(
      { ...ON, error: 'Port 39417 is in use by another program.' },
      {
        clients: [client(1000)],
        calls: [],
      },
    )
    expect(button()?.dataset.stateName).toBe('error')
  })

  test('is on and idle, with no badge, with no client seen', async () => {
    await mountButton(ON)
    expect(button()?.getAttribute('aria-label')).toBe(getText('mcpActivityNameIdle'))
    expect(button()?.querySelector('.badge')).toBeNull()
  })

  test('is on and idle while the server is starting', async () => {
    await mountButton({ ...OFF, enabled: true })
    expect(button()?.dataset.stateName).toBe('idle')
  })

  test('is connected, with a badge, once a client was seen', async () => {
    await mountButton(ON, {
      clients: [client(60_000)],
      calls: [call(1, 'get_graph', 'ok', 60_000)],
    })
    expect(button()?.getAttribute('aria-label')).toBe(
      getText('mcpActivityNameConnected', 'Claude Code'),
    )
    expect(button()?.querySelector('.badge')).not.toBeNull()
  })

  test('is active while a call runs, and lapses to connected 10 s after it ends', async () => {
    await mountButton(ON, {
      clients: [client(0)],
      calls: [call(1, 'get_graph', 'ok', 4000)],
    })
    expect(button()?.dataset.stateName).toBe('active')
    expect(button()?.getAttribute('aria-label')).toBe(
      getText('mcpActivityNameActive', 'Claude Code'),
    )
    await advance(5000)
    expect(button()?.dataset.stateName).toBe('active')
    await advance(2000)
    expect(button()?.dataset.stateName).toBe('connected')
  })

  test('is active while a call has not ended, however long ago it started', async () => {
    await mountButton(ON, {
      clients: [client(0)],
      calls: [call(1, 'evaluate_expression', 'running')],
    })
    await advance(60_000)
    expect(button()?.dataset.stateName).toBe('active')
  })

  test('lapses from connected to idle 15 minutes after the last request', async () => {
    await mountButton(ON, { clients: [client(14 * 60_000)], calls: [] })
    expect(button()?.dataset.stateName).toBe('connected')
    await advance(61_000)
    expect(button()?.dataset.stateName).toBe('idle')
  })

  test('follows the status and activity main broadcasts', async () => {
    await mountButton(OFF)
    fake.emitStatus?.(ON)
    await flushPromises()
    expect(button()?.dataset.stateName).toBe('idle')
    fake.emitActivity?.({ clients: [client(0)], calls: [call(1, 'get_graph', 'running')] })
    await flushPromises()
    expect(button()?.dataset.stateName).toBe('active')
  })
})

describe('the popover', () => {
  test('when off, warns, offers Enable and links to Settings', async () => {
    await mountButton(OFF)
    await openPopover()
    expect(popover()?.textContent).toContain(getText('mcpActivityOffText'))
    expect(popover()?.textContent).toContain(getText('mcpWarning'))
    expect(byTestId('mcp-activity-enable')).not.toBeNull()
    expect(byTestId('mcp-activity-settings')).not.toBeNull()
  })

  test('Enable asks main to turn MCP on, once, and then shows it on', async () => {
    await mountButton(OFF)
    await openPopover()
    await user().click(byTestId('mcp-activity-enable')!)
    await flushPromises()
    expect(fake.setEnabled).toHaveBeenCalledOnce()
    expect(fake.setEnabled).toHaveBeenCalledWith(true)
    expect(button()?.dataset.stateName).toBe('idle')
    expect(popover()?.textContent).toContain(`http://127.0.0.1:${MCP_DEFAULT_PORT}/mcp`)
    expect(popover()?.textContent).toContain(getText('mcpActivityNoClient'))
  })

  test('Enable shows a rejection under the button', async () => {
    fake.setEnabled.mockRejectedValue(new Error('The settings file could not be written'))
    await mountButton(OFF)
    await openPopover()
    await user().click(byTestId('mcp-activity-enable')!)
    await flushPromises()
    expect(byTestId('mcp-activity-enable-error')?.textContent).toContain(
      'The settings file could not be written',
    )
    expect(button()?.dataset.stateName).toBe('off')
  })

  test('Enable is disabled while an environment variable fixes the setting', async () => {
    await mountButton({ ...OFF, lockedByEnvironment: true })
    await openPopover()
    expect(byTestId('mcp-activity-enable')?.hasAttribute('disabled')).toBe(true)
    expect(popover()?.textContent).toContain(getText('mcpLockedByEnvironment'))
    expect(popover()?.textContent).not.toContain(getText('mcpWarning'))
  })

  test("with an error, shows main's text and no Enable", async () => {
    await mountButton({ ...OFF, error: 'The MCP settings file could not be read: oops' })
    await openPopover()
    expect(byTestId('mcp-activity-error')?.textContent).toContain('could not be read: oops')
    expect(byTestId('mcp-activity-enable')).toBeNull()
  })

  test('idle after a client was seen says when, and keeps the calls', async () => {
    await mountButton(ON, {
      clients: [client(2 * 3600_000)],
      calls: [call(1, 'get_graph', 'ok', 2 * 3600_000)],
    })
    await openPopover()
    expect(byTestId('mcp-activity-last-seen')?.textContent).toContain('Claude Code')
    expect(byTestId('mcp-activity-last-seen')?.textContent).toContain('2 hours ago')
    expect(byTestId('mcp-activity-calls')?.children).toHaveLength(1)
  })

  test('connected lists the client and its calls with their outcomes', async () => {
    await mountButton(ON, {
      clients: [client(1000)],
      calls: [
        call(5, 'add_nodes', 'running'),
        call(4, 'get_graph', 'ok', 12_000),
        call(3, 'evaluate_expression', 'refused', 40_000),
        call(2, 'search_components', 'ok', 60_000),
        call(1, 'get_visualization', 'error', 180_000),
      ],
    })
    await openPopover()
    expect(byTestId('mcp-activity-clients')?.textContent).toContain('Claude Code 2.0.14')
    const items = Array.from(byTestId('mcp-activity-calls')?.children ?? [])
    expect(items.map((item) => item.getAttribute('data-outcome'))).toEqual([
      'running',
      'ok',
      'refused',
      'ok',
      'error',
    ])
    expect(items[1]?.getAttribute('aria-label')).toBe('get_graph, OK, 12 seconds ago')
    expect(items[2]?.textContent).toContain(getText('mcpActivityRefused'))
    expect(items[4]?.textContent).toContain(getText('mcpActivityError'))
    expect(items[0]?.textContent).toContain(getText('mcpActivityRunning'))
  })

  test('Escape closes it and focus returns to the icon', async () => {
    await mountButton(OFF)
    await openPopover()
    expect(popover()).not.toBeNull()
    await user().keyboard('{Escape}')
    await flushPromises()
    await advance(500)
    expect(popover()).toBeNull()
    expect(document.activeElement).toBe(button())
  })

  test('shows nothing but names, outcomes and times, whatever main sends', async () => {
    const MARKER = 'SECRET-MARKER-42'
    const leaky = {
      clients: [client(1000)],
      calls: [{ ...call(1, 'get_graph', 'error', 1000), args: { path: MARKER }, error: MARKER }],
    } as unknown as McpActivitySnapshot
    await mountButton(ON, leaky)
    await openPopover()
    expect(document.body.textContent).not.toContain(MARKER)
    expect(document.body.innerHTML).not.toContain(MARKER)
  })
})
