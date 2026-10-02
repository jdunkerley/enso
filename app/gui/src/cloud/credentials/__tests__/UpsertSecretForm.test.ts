/**
 * @file Behaviour of the Vue `UpsertSecretForm`: the fields for a new and an existing secret,
 * focus, submission with the keyboard and the mouse, validation, and each kind of Cancel.
 */
import {
  byTestId,
  mountWithProviders,
  usePrimitiveTestEnvironment,
} from '$/components/__tests__/mountWithProviders'
import Dialog from '$/components/Dialog/Dialog.vue'
import { useText } from '$/providers/text'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import type { SecretId } from 'enso-common/src/services/Backend'
import { describe, expect, test, vi } from 'vitest'
import { h, ref } from 'vue'
import UpsertSecretForm from '../UpsertSecretForm.vue'

usePrimitiveTestEnvironment()
const { getText } = useText()

function mountSecretForm(props: Record<string, unknown> = {}) {
  const onCreate = vi.fn()
  const onCancel = vi.fn()
  mountWithProviders(() => h(UpsertSecretForm, { onCreate, onCancel, ...props }))
  return { onCreate, onCancel }
}

const input = (placeholder: string) =>
  document.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`)
const button = (name: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === name)

describe('UpsertSecretForm', () => {
  test('a new secret: name (focused) and value, created with Enter', async () => {
    const { onCreate } = mountSecretForm()
    await flushPromises()
    const name = input(getText('secretNamePlaceholder'))!
    const value = input(getText('secretValuePlaceholder'))!
    expect(byTestId('upsert-secret-modal')?.tagName).toBe('FORM')
    // After the same short delay as React's `useAutoFocus`.
    await vi.waitFor(() => expect(document.activeElement).toBe(name))
    expect(name.autocomplete).toBe('off')
    expect(value.type).toBe('password')
    expect(value.autocomplete).toBe('off')
    expect(button(getText('create'))).toBeDefined()

    const user = userEvent.setup()
    await user.keyboard('my-secret')
    await user.tab()
    await user.keyboard('hunter2{Enter}')
    await flushPromises()
    expect(onCreate).toHaveBeenCalledExactlyOnceWith('my-secret', 'hunter2')
  })

  test('a name is required', async () => {
    const { onCreate } = mountSecretForm()
    await flushPromises()
    await userEvent.setup().click(button(getText('create'))!)
    await flushPromises()
    expect(onCreate).not.toHaveBeenCalled()
    expect(input(getText('secretNamePlaceholder'))!.getAttribute('aria-invalid')).toBe('true')
  })

  test('an existing secret: only a new value, and Update', async () => {
    const { onCreate } = mountSecretForm({ secretId: 'secret-1' as SecretId, name: 'api-key' })
    await flushPromises()
    expect(input(getText('secretNamePlaceholder'))).toBeNull()
    const value = input(getText('secretValueHidden'))!
    const user = userEvent.setup()
    await user.click(value)
    await user.keyboard('new-value')
    await user.click(button(getText('update'))!)
    await flushPromises()
    expect(onCreate).toHaveBeenCalledExactlyOnceWith('api-key', 'new-value')
  })

  test('no Cancel button unless asked for', async () => {
    mountSecretForm()
    await flushPromises()
    expect(button(getText('cancel'))).toBeUndefined()
  })

  test('cancel="emit": Cancel emits cancel', async () => {
    const { onCancel, onCreate } = mountSecretForm({ cancel: 'emit' })
    await flushPromises()
    await userEvent.setup().click(button(getText('cancel'))!)
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onCreate).not.toHaveBeenCalled()
  })

  test('cancel="reset": Cancel restores the defaults', async () => {
    mountSecretForm({ cancel: 'reset', name: 'draft' })
    await flushPromises()
    const name = input(getText('secretNamePlaceholder'))!
    expect(name.value).toBe('draft')
    const user = userEvent.setup()
    await user.click(name)
    await user.keyboard('-changed')
    expect(name.value).toBe('draft-changed')
    await user.click(button(getText('cancel'))!)
    await flushPromises()
    expect(name.value).toBe('draft')
  })

  test('in a dialog, cancel="close" closes it, and so does a submission', async () => {
    const open = ref(true)
    const onCreate = vi.fn()
    mountWithProviders(() =>
      h(
        Dialog,
        {
          title: 'New Secret',
          open: open.value,
          'onUpdate:open': (v: boolean) => (open.value = v),
        },
        () => h(UpsertSecretForm, { cancel: 'close', onCreate }),
      ),
    )
    await flushPromises()
    const user = userEvent.setup()
    await user.click(button(getText('cancel'))!)
    await flushPromises()
    expect(open.value).toBe(false)

    open.value = true
    await flushPromises()
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(input(getText('secretNamePlaceholder'))),
    )
    await user.keyboard('name')
    await user.click(button(getText('create'))!)
    await flushPromises()
    expect(onCreate).toHaveBeenCalledExactlyOnceWith('name', '')
    expect(open.value).toBe(false)
  })
})
