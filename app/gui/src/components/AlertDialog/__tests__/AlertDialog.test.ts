/**
 * @file The Vue `AlertDialog`'s answer, submitted through a form as React's was (#84): a failure
 * shown under the buttons, the offline notice, and a dialog without a cancel button.
 */
import {
  byTestId,
  h,
  mountWithProviders,
  usePrimitiveTestEnvironment,
} from '$/components/__tests__/mountWithProviders'
import AlertDialog from '$/components/AlertDialog/AlertDialog.vue'
import { onlineManager } from '@tanstack/vue-query'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ref } from 'vue'

usePrimitiveTestEnvironment()

afterEach(() => onlineManager.setOnline(true))

const alertDialog = () => document.querySelector<HTMLElement>('[role="alertdialog"]')

function setup(props: Record<string, unknown>) {
  const open = ref(true)
  mountWithProviders(() =>
    h(
      AlertDialog,
      {
        title: 'Question',
        message: 'Really?',
        open: open.value,
        'onUpdate:open': (value: boolean) => (open.value = value),
        ...props,
      },
      {},
    ),
  )
  return open
}

describe('AlertDialog', () => {
  test('`cancel: null` leaves out the cancel button', async () => {
    setup({ cancel: null })
    await flushPromises()
    expect(byTestId('alert-dialog-confirm')).not.toBeNull()
    expect(byTestId('alert-dialog-cancel')).toBeNull()
  })

  test('a failed answer stays open, shows why under the buttons, and may be tried again', async () => {
    const onConfirm = vi.fn().mockRejectedValueOnce(new Error('The server said no.'))
    const open = setup({ onConfirm })
    await flushPromises()
    const user = userEvent.setup()
    await user.click(byTestId('alert-dialog-confirm')!)
    await flushPromises()
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(open.value).toBe(true)
    expect(alertDialog()).not.toBeNull()
    expect(byTestId('form-submit-error')!.textContent!.trim()).toBe('The server said no.')

    await user.click(byTestId('alert-dialog-confirm')!)
    await flushPromises()
    expect(onConfirm).toHaveBeenCalledTimes(2)
    expect(open.value).toBe(false)
  })

  test('a failed cancel also stays open with the error', async () => {
    const onCancel = vi.fn().mockRejectedValue(new Error('Could not decline.'))
    const open = setup({ onCancel })
    await flushPromises()
    await userEvent.setup().click(byTestId('alert-dialog-cancel')!)
    await flushPromises()
    expect(open.value).toBe(true)
    expect(byTestId('form-submit-error')!.textContent!.trim()).toBe('Could not decline.')
  })

  test('with `canSubmitOffline: false`, it shows the offline notice and does not answer', async () => {
    onlineManager.setOnline(false)
    const onConfirm = vi.fn()
    const open = setup({ onConfirm, canSubmitOffline: false })
    await flushPromises()
    expect(byTestId('form-submit-offline')).not.toBeNull()
    await userEvent.setup().click(byTestId('alert-dialog-confirm')!)
    await flushPromises()
    expect(onConfirm).not.toHaveBeenCalled()
    expect(open.value).toBe(true)
  })

  test('by default it answers offline, as before', async () => {
    onlineManager.setOnline(false)
    const onConfirm = vi.fn()
    const open = setup({ onConfirm })
    await flushPromises()
    expect(byTestId('form-submit-offline')).toBeNull()
    await userEvent.setup().click(byTestId('alert-dialog-confirm')!)
    await flushPromises()
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(open.value).toBe(false)
  })
})
