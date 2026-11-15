/**
 * @file The AI tab's External agents section: the switch, the warning, the address and port, the
 * per-client setup buttons, the token replacement, and the server's error.
 */
import ModalHost from '$/components/ModalHost/ModalHost.vue'
import { useModals } from '$/providers/modals'
import { useText } from '$/providers/text'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { MCP_CLIENT_KINDS, MCP_DEFAULT_PORT, type McpStatus } from 'enso-common/src/mcp'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { h } from 'vue'
import McpSettingsSection from '../McpSettingsSection.vue'
import { required } from './dom'

const fake = vi.hoisted(() => ({
  status: vi.fn(),
  onStatusChanged: vi.fn(),
  setEnabled: vi.fn(),
  setPort: vi.fn(),
  replaceToken: vi.fn(),
  copyConfig: vi.fn(),
  show: vi.fn(),
  emit: undefined as ((status: McpStatus) => void) | undefined,
}))

vi.mock('$/providers/toasts', () => ({ useToasts: () => ({ show: fake.show }) }))

const { getText } = useText()

const OFF: McpStatus = {
  enabled: false,
  port: MCP_DEFAULT_PORT,
  running: false,
  error: null,
  lockedByEnvironment: false,
}
const ON: McpStatus = {
  enabled: true,
  port: MCP_DEFAULT_PORT,
  running: true,
  error: null,
  lockedByEnvironment: false,
}
const ADDRESS = `http://127.0.0.1:${MCP_DEFAULT_PORT}/mcp`

beforeEach(() => {
  fake.status.mockResolvedValue(OFF)
  fake.setEnabled.mockResolvedValue(ON)
  fake.setPort.mockImplementation((port: number) => Promise.resolve({ ...ON, port }))
  fake.replaceToken.mockResolvedValue(ON)
  fake.copyConfig.mockResolvedValue(undefined)
  fake.onStatusChanged.mockImplementation((handler: (status: McpStatus) => void) => {
    fake.emit = handler
    return () => {
      fake.emit = undefined
    }
  })
  vi.stubGlobal('api', {
    ...window.api,
    mcp: {
      status: fake.status,
      onStatusChanged: fake.onStatusChanged,
      setEnabled: fake.setEnabled,
      setPort: fake.setPort,
      replaceToken: fake.replaceToken,
      copyConfig: fake.copyConfig,
    },
  })
  useModals().closeAll()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

async function mountSection() {
  await mountWithProviders(() => h('div', [h(McpSettingsSection), h(ModalHost)]))
  await flushPromises()
}

const button = (name: string, container: ParentNode = document) =>
  required(
    [...container.querySelectorAll<HTMLElement>('button')].find(
      (element) => element.textContent.trim() === name,
    ),
    `the ${name} button`,
  )
const dialog = () =>
  required(document.querySelector<HTMLElement>('[role="dialog"], [role="alertdialog"]'))
const switchInput = () =>
  required(document.querySelector<HTMLInputElement>('input[role="switch"]'), 'the switch')
const portInput = () =>
  required(document.querySelector<HTMLInputElement>('input[name="port"]'), 'the port field')

describe('McpSettingsSection', () => {
  test('off: the switch is off, the warning shows, there is no address', async () => {
    await mountSection()
    expect(switchInput().checked).toBe(false)
    expect(document.body.textContent).toContain(getText('mcpEnabledSetting'))
    expect(document.body.textContent).toContain(getText('mcpWarning'))
    expect(document.body.textContent).not.toContain(ADDRESS)
    expect(document.querySelector('input[name="port"]')).toBeNull()
  })

  test('turning it on calls setEnabled and shows the address', async () => {
    await mountSection()
    const user = userEvent.setup()
    await user.click(switchInput())
    await flushPromises()
    expect(fake.setEnabled).toHaveBeenCalledExactlyOnceWith(true)
    expect(document.body.textContent).toContain(ADDRESS)
    expect(switchInput().checked).toBe(true)
  })

  test('shows the address and the setup buttons when it is already on', async () => {
    fake.status.mockResolvedValue(ON)
    await mountSection()
    expect(document.body.textContent).toContain(ADDRESS)
    expect(switchInput().checked).toBe(true)
    for (const label of [
      'mcpClientClaudeCode',
      'mcpClientCodex',
      'mcpClientCopilotVsCode',
      'mcpClientCopilotCli',
      'mcpClientJson',
    ] as const) {
      button(getText(label))
    }
    expect(MCP_CLIENT_KINDS).toHaveLength(5)
  })

  test('follows a status change from Electron main', async () => {
    await mountSection()
    expect(document.body.textContent).not.toContain(ADDRESS)
    fake.emit?.(ON)
    await flushPromises()
    expect(document.body.textContent).toContain(ADDRESS)
  })

  test.each([
    ['mcpClientClaudeCode', 'claudeCode'],
    ['mcpClientCodex', 'codex'],
    ['mcpClientCopilotVsCode', 'copilotVsCode'],
    ['mcpClientCopilotCli', 'copilotCli'],
    ['mcpClientJson', 'json'],
  ] as const)('the %s button copies the %s setup and says so', async (label, kind) => {
    fake.status.mockResolvedValue(ON)
    await mountSection()
    const user = userEvent.setup()
    await user.click(button(getText(label)))
    await flushPromises()
    expect(fake.copyConfig).toHaveBeenCalledExactlyOnceWith(kind)
    expect(fake.show).toHaveBeenCalledWith(getText('copied'), { type: 'success' })
  })

  test('shows the server error under the switch', async () => {
    fake.status.mockResolvedValue({ ...ON, running: false, error: 'Port 39417 is in use.' })
    await mountSection()
    expect(required(document.querySelector('[role="alert"]')).textContent).toContain(
      'Port 39417 is in use.',
    )
  })

  test('shows no error when there is none', async () => {
    fake.status.mockResolvedValue(ON)
    await mountSection()
    expect(document.querySelector('[data-testid="mcp-error"]')).toBeNull()
    expect(document.querySelector('[role="alert"]')).toBeNull()
  })

  test('submitting a valid port calls setPort', async () => {
    fake.status.mockResolvedValue(ON)
    await mountSection()
    const user = userEvent.setup()
    await user.clear(portInput())
    await user.type(portInput(), '40000')
    await user.click(button(getText('save')))
    await flushPromises()
    expect(fake.setPort).toHaveBeenCalledExactlyOnceWith(40000)
    expect(document.body.textContent).toContain('http://127.0.0.1:40000/mcp')
  })

  test('a port below 1024 shows a message and is not sent', async () => {
    fake.status.mockResolvedValue(ON)
    await mountSection()
    const user = userEvent.setup()
    await user.clear(portInput())
    await user.type(portInput(), '80')
    await user.click(button(getText('save')))
    await flushPromises()
    expect(fake.setPort).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain(getText('mcpPortInvalid'))
  })

  test('New token asks first, then replaces it and says so', async () => {
    fake.status.mockResolvedValue(ON)
    await mountSection()
    const user = userEvent.setup()
    await user.click(button(getText('mcpNewToken')))
    await vi.waitFor(dialog)
    expect(dialog().textContent).toContain(getText('mcpNewTokenWarning'))
    expect(fake.replaceToken).not.toHaveBeenCalled()
    await user.click(button(getText('mcpNewToken'), dialog()))
    await flushPromises()
    expect(fake.replaceToken).toHaveBeenCalledOnce()
    expect(fake.show).toHaveBeenCalledWith(getText('mcpTokenReplaced'), { type: 'success' })
  })

  test('cancelling the New token dialog replaces nothing', async () => {
    fake.status.mockResolvedValue(ON)
    await mountSection()
    const user = userEvent.setup()
    await user.click(button(getText('mcpNewToken')))
    await vi.waitFor(dialog)
    await user.click(button(getText('cancel'), dialog()))
    await flushPromises()
    expect(fake.replaceToken).not.toHaveBeenCalled()
  })

  test('while the environment fixes the setting, the switch and port are disabled, with a note', async () => {
    fake.status.mockResolvedValue({ ...ON, lockedByEnvironment: true })
    await mountSection()
    expect(switchInput().disabled).toBe(true)
    expect(portInput().disabled).toBe(true)
    expect(document.body.textContent).toContain(getText('mcpLockedByEnvironment'))
  })

  test('shows no lock note while nothing fixes the setting', async () => {
    fake.status.mockResolvedValue(ON)
    await mountSection()
    expect(switchInput().disabled).toBe(false)
    expect(portInput().disabled).toBe(false)
    expect(document.body.textContent).not.toContain(getText('mcpLockedByEnvironment'))
  })

  test('a setEnabled(false) that resolves still on leaves the switch on', async () => {
    fake.status.mockResolvedValue(ON)
    fake.setEnabled.mockResolvedValue(ON)
    await mountSection()
    const user = userEvent.setup()
    await user.click(switchInput())
    await flushPromises()
    expect(fake.setEnabled).toHaveBeenCalledExactlyOnceWith(false)
    expect(switchInput().checked).toBe(true)
  })

  test('a setPort that resolves with another port shows the port it resolved with', async () => {
    fake.status.mockResolvedValue(ON)
    fake.setPort.mockResolvedValue(ON)
    await mountSection()
    const user = userEvent.setup()
    await user.clear(portInput())
    await user.type(portInput(), '40000')
    await user.click(button(getText('save')))
    await flushPromises()
    expect(portInput().value).toBe(String(MCP_DEFAULT_PORT))
  })

  test('a failed setPort is shown once, in the form', async () => {
    fake.status.mockResolvedValue(ON)
    fake.setPort.mockRejectedValue(new Error('Port refused'))
    await mountSection()
    const user = userEvent.setup()
    await user.clear(portInput())
    await user.type(portInput(), '40000')
    await user.click(button(getText('save')))
    await flushPromises()
    expect(document.body.textContent?.split('Port refused')).toHaveLength(2)
    expect(fake.show).not.toHaveBeenCalled()
  })

  test('a failed setEnabled is shown as a toast', async () => {
    fake.setEnabled.mockRejectedValue(new Error('no keychain'))
    await mountSection()
    const user = userEvent.setup()
    await user.click(switchInput())
    await flushPromises()
    expect(fake.show).toHaveBeenCalledWith('no keychain', { type: 'error' })
    expect(switchInput().checked).toBe(false)
  })
})
