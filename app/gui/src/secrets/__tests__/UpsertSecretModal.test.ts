/**
 * @file The drive's secret dialog (#92): its titles, that it opens focused on the first field,
 * creates on submission and closes, and that Cancel and Escape close it without creating, while an
 * outside click does not.
 */
import {
  byTestId,
  mountWithProviders,
  usePrimitiveTestEnvironment,
} from '$/components/__tests__/mountWithProviders'
import { useText } from '$/providers/text'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import type { SecretId } from 'enso-common/src/services/Backend'
import { describe, expect, test, vi } from 'vitest'
import { h } from 'vue'
import UpsertSecretModal from '../UpsertSecretModal.vue'

usePrimitiveTestEnvironment()
const { getText } = useText()

function mountModal(props: Record<string, unknown> = {}) {
  const onCreate = vi.fn()
  const onClose = vi.fn()
  mountWithProviders(() => h(UpsertSecretModal, { onCreate, onClose, ...props }))
  return { onCreate, onClose }
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')
const input = (placeholder: string) =>
  document.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`)
const button = (name: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === name)

describe('UpsertSecretModal', () => {
  test('a new secret: "New Secret", the name focused, created with Enter, then closed', async () => {
    const { onCreate, onClose } = mountModal()
    await flushPromises()
    expect(dialog()?.querySelector('h2')?.textContent).toBe(getText('newSecret'))
    expect(dialog()?.contains(byTestId('upsert-secret-modal'))).toBe(true)
    const name = input(getText('secretNamePlaceholder'))!
    await vi.waitFor(() => expect(document.activeElement).toBe(name))

    const user = userEvent.setup()
    await user.keyboard('my-secret')
    await user.tab()
    await user.keyboard('hunter2{Enter}')
    await flushPromises()
    expect(onCreate).toHaveBeenCalledExactlyOnceWith('my-secret', 'hunter2')
    // It leaves the stack once its exit animation has ended (none in jsdom).
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  test('an existing secret: "Edit Secret", only the value, and Update', async () => {
    const { onCreate } = mountModal({ secretId: 'secret-1' as SecretId, name: 'api-key' })
    await flushPromises()
    expect(dialog()?.querySelector('h2')?.textContent).toBe(getText('editSecret'))
    expect(input(getText('secretNamePlaceholder'))).toBeNull()
    const value = input(getText('secretValueHidden'))!
    await userEvent.setup().type(value, 'new-value')
    await userEvent.setup().click(button(getText('update'))!)
    await flushPromises()
    expect(onCreate).toHaveBeenCalledExactlyOnceWith('api-key', 'new-value')
  })

  test('Cancel closes it without creating', async () => {
    const { onCreate, onClose } = mountModal()
    await flushPromises()
    await userEvent.setup().click(button(getText('cancel'))!)
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(onCreate).not.toHaveBeenCalled()
  })

  test('without `canCancel` there is no Cancel button', async () => {
    mountModal({ canCancel: false })
    await flushPromises()
    expect(button(getText('cancel'))).toBeUndefined()
  })

  test('Escape closes it; an outside click does not', async () => {
    const { onClose } = mountModal()
    await flushPromises()
    const user = userEvent.setup()
    // The layer around the dialog, as a click beside it lands.
    await user.click(byTestId('modal-dialog')!)
    await flushPromises()
    expect(dialog()).not.toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
  })
})
