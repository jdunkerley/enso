/** @file The session overlays: which one shows, how it is named, and that it cannot be dismissed. */
import {
  mountWithProviders,
  usePrimitiveTestEnvironment,
} from '$/components/__tests__/mountWithProviders'
import SessionOverlays from '$/components/SessionOverlays.vue'
import { useText } from '$/providers/text'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { describe, expect, test, vi } from 'vitest'
import { h, reactive } from 'vue'

const session = reactive({ isLoggingOut: false, isReconnectingSession: false })
vi.mock('$/providers/session', () => ({ useSession: () => session }))

usePrimitiveTestEnvironment()
const { getText } = useText()

const dialogs = () => [...document.querySelectorAll('[role="dialog"]')]

describe('SessionOverlays', () => {
  test('nothing while the session is idle', async () => {
    Object.assign(session, { isLoggingOut: false, isReconnectingSession: false })
    mountWithProviders(() => h(SessionOverlays))
    await flushPromises()
    expect(dialogs()).toHaveLength(0)
  })

  test('logging out: a named, focused dialog that Escape does not close', async () => {
    Object.assign(session, { isLoggingOut: true, isReconnectingSession: true })
    mountWithProviders(() => h(SessionOverlays))
    await flushPromises()
    expect(dialogs()).toHaveLength(1)
    const dialog = dialogs()[0]!
    expect(dialog.getAttribute('aria-label')).toBe(getText('loggingOut'))
    expect(dialog.textContent).toContain(getText('loggingOut'))
    await vi.waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
    await userEvent.setup().keyboard('{Escape}')
    await flushPromises()
    expect(dialogs()).toHaveLength(1)
  })

  test('reconnecting, when not logging out', async () => {
    Object.assign(session, { isLoggingOut: false, isReconnectingSession: true })
    mountWithProviders(() => h(SessionOverlays))
    await flushPromises()
    expect(dialogs().map((d) => d.getAttribute('aria-label'))).toEqual([
      getText('reconnectingSession'),
    ])
    session.isReconnectingSession = false
    await vi.waitFor(() => expect(dialogs()).toHaveLength(0))
  })
})
