/** @file The Vue `ConfirmDeleteModal`, asked through the modal stack as its callers do. */
import {
  byTestId,
  mountWithProviders,
  usePrimitiveTestEnvironment,
} from '$/components/__tests__/mountWithProviders'
import ConfirmDeleteModal from '$/components/AlertDialog/ConfirmDeleteModal.vue'
import ModalHost from '$/components/ModalHost/ModalHost.vue'
import { createModalsStore } from '$/providers/modals'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { describe, expect, test, vi } from 'vitest'
import { h } from 'vue'

usePrimitiveTestEnvironment()

const alertDialog = () => document.querySelector<HTMLElement>('[role="alertdialog"]')

function setup() {
  const store = createModalsStore()
  mountWithProviders(() => h(ModalHost, { store }))
  return store
}

describe('ConfirmDeleteModal', () => {
  test('asks "Are you sure?", with the action in the prompt and a Delete button', async () => {
    const store = setup()
    void store.ask(ConfirmDeleteModal, { actionText: "delete 'Report'" })
    await flushPromises()
    const dialog = alertDialog()!
    expect(dialog.querySelector('h2')!.textContent!.trim()).toBe('Are you sure?')
    expect(dialog.textContent).toContain("Do you really want to delete 'Report'?")
    expect(byTestId('alert-dialog-confirm')!.textContent!.trim()).toBe('Delete')
    expect(byTestId('alert-dialog-confirm')!.classList).toContain('bg-danger/80')
    expect(byTestId('alert-dialog-cancel')!.textContent!.trim()).toBe('Cancel')
    expect(document.activeElement).toBe(byTestId('alert-dialog-confirm'))
    // No alerts unless asked for.
    expect(dialog.textContent).not.toContain('cannot be undone')
  })

  test('shows the alert, the "cannot be undone" warning and a custom button label', async () => {
    const store = setup()
    void store.ask(ConfirmDeleteModal, {
      actionText: 'remove it',
      actionButtonLabel: 'Remove',
      alert: 'It is shared.',
      cannotUndo: true,
    })
    await flushPromises()
    const dialog = alertDialog()!
    expect(dialog.textContent).toContain('It is shared.')
    expect(dialog.textContent).toContain('This operation is final and cannot be undone.')
    expect(byTestId('alert-dialog-confirm')!.textContent!.trim()).toBe('Remove')
  })

  test('confirming runs onConfirm, resolves the ask, and the modal leaves the stack', async () => {
    const store = setup()
    const onConfirm = vi.fn()
    const answer = store.ask(ConfirmDeleteModal, { actionText: 'delete it', onConfirm })
    await flushPromises()
    await userEvent.setup().click(byTestId('alert-dialog-confirm')!)
    await flushPromises()
    expect(onConfirm).toHaveBeenCalledOnce()
    await expect(answer).resolves.toBe('confirm')
    expect(alertDialog()).toBeNull()
    expect(store.stack.value).toEqual([])
  })

  test('a failed deletion keeps the question open, with its error, as React did', async () => {
    const store = setup()
    const onConfirm = vi
      .fn()
      .mockRejectedValueOnce(new Error('Could not delete user: not allowed'))
      .mockResolvedValueOnce(undefined)
    const answer = store.ask(ConfirmDeleteModal, { actionText: 'delete it', onConfirm })
    await flushPromises()
    const user = userEvent.setup()
    await user.click(byTestId('alert-dialog-confirm')!)
    await flushPromises()
    expect(alertDialog()).not.toBeNull()
    expect(byTestId('form-submit-error')?.textContent.trim()).toBe(
      'Could not delete user: not allowed',
    )
    // Answering again clears the error, and this time the deletion goes through.
    await user.click(byTestId('alert-dialog-confirm')!)
    await flushPromises()
    await expect(answer).resolves.toBe('confirm')
    expect(onConfirm).toHaveBeenCalledTimes(2)
  })

  test('cancelling resolves the ask as dismissed, without deleting', async () => {
    const store = setup()
    const onConfirm = vi.fn()
    const answer = store.ask(ConfirmDeleteModal, { actionText: 'delete it', onConfirm })
    await flushPromises()
    await userEvent.setup().click(byTestId('alert-dialog-cancel')!)
    await flushPromises()
    await expect(answer).resolves.toBe('dismiss')
    expect(onConfirm).not.toHaveBeenCalled()
    expect(store.stack.value).toEqual([])
  })
})
