/** @file The "Save a version" dialog: an optional comment, saved with Enter or Save. */
import {
  byTestId,
  mountWithProviders,
  usePrimitiveTestEnvironment,
} from '$/components/__tests__/mountWithProviders'
import SaveVersionModal from '$/components/LocalVersioning/SaveVersionModal.vue'
import ModalHost from '$/components/ModalHost/ModalHost.vue'
import { createModalsStore } from '$/providers/modals'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { describe, expect, test, vi } from 'vitest'
import { h } from 'vue'

usePrimitiveTestEnvironment()

function setup() {
  const store = createModalsStore()
  mountWithProviders(() => h(ModalHost, { store }))
  return store
}

// `BasicInput` overrides a `data-testid` passed to it, so the field is found by its name.
const comment = () =>
  document.querySelector<HTMLInputElement>('input[aria-label="Comment (optional)"]')!

describe('SaveVersionModal', () => {
  test('opens with the focus in the comment; Enter saves with it', async () => {
    const store = setup()
    const onSave = vi.fn()
    store.open(SaveVersionModal, { onSave })
    await flushPromises()
    await vi.waitFor(() => expect(document.activeElement).toBe(comment()))
    await userEvent.type(comment(), 'Cleaned the dates{Enter}')
    expect(onSave).toHaveBeenCalledWith('Cleaned the dates')
    await vi.waitFor(() => expect(store.stack.value).toHaveLength(0))
  })

  test('Save with no comment saves an empty one; Cancel saves nothing', async () => {
    const store = setup()
    const onSave = vi.fn()
    store.open(SaveVersionModal, { onSave })
    await flushPromises()
    await userEvent.click(byTestId('save-version-save')!)
    expect(onSave).toHaveBeenCalledWith('')
    await vi.waitFor(() => expect(store.stack.value).toHaveLength(0))
    store.open(SaveVersionModal, { onSave })
    await flushPromises()
    await userEvent.click(byTestId('save-version-cancel')!)
    await vi.waitFor(() => expect(store.stack.value).toHaveLength(0))
    expect(onSave).toHaveBeenCalledOnce()
  })
})
