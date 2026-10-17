/** @file The repository prompt's three answers, asked through the modal stack. */
import {
  byTestId,
  mountWithProviders,
  usePrimitiveTestEnvironment,
} from '$/components/__tests__/mountWithProviders'
import RepositoryPromptModal from '$/components/LocalVersioning/RepositoryPromptModal.vue'
import ModalHost from '$/components/ModalHost/ModalHost.vue'
import { createModalsStore } from '$/providers/modals'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { describe, expect, test, vi } from 'vitest'
import { h } from 'vue'

usePrimitiveTestEnvironment()

const dialog = () => document.querySelector<HTMLElement>('[role="alertdialog"]')!

function setup() {
  const store = createModalsStore()
  mountWithProviders(() => h(ModalHost, { store }))
  return store
}

describe('RepositoryPromptModal', () => {
  test('"create" names the root, and confirms with Create', async () => {
    const store = setup()
    const answer = store.ask(RepositoryPromptModal, {
      kind: 'create',
      folder: '/home/me/enso-projects',
      onDontAskAgain: vi.fn(),
    })
    await flushPromises()
    expect(dialog().textContent).toContain(
      'Keep versions of your projects with git? This creates a repository in /home/me/enso-projects.',
    )
    expect(byTestId('alert-dialog-confirm')!.textContent!.trim()).toBe('Create')
    expect(byTestId('alert-dialog-cancel')!.textContent!.trim()).toBe('Not now')
    expect(byTestId('repository-prompt-dont-ask-again')!.textContent!.trim()).toBe(
      "Don't ask again for this folder",
    )
    await userEvent.click(byTestId('alert-dialog-confirm')!)
    await expect(answer).resolves.toBe('confirm')
  })

  test('"use" names the repository; Don\'t ask again dismisses and reports it', async () => {
    const store = setup()
    const onDontAskAgain = vi.fn()
    const answer = store.ask(RepositoryPromptModal, {
      kind: 'use',
      folder: '/home/me',
      onDontAskAgain,
    })
    await flushPromises()
    expect(dialog().textContent).toContain(
      'Keep versions of your projects in the existing repository at /home/me?',
    )
    expect(byTestId('alert-dialog-confirm')!.textContent!.trim()).toBe('Use')
    await userEvent.click(byTestId('repository-prompt-dont-ask-again')!)
    await expect(answer).resolves.toBe('dismiss')
    expect(onDontAskAgain).toHaveBeenCalledOnce()
  })

  test('Not now dismisses without "Don\'t ask again"', async () => {
    const store = setup()
    const onDontAskAgain = vi.fn()
    const answer = store.ask(RepositoryPromptModal, {
      kind: 'create',
      folder: '/r',
      onDontAskAgain,
    })
    await flushPromises()
    await userEvent.click(byTestId('alert-dialog-cancel')!)
    await expect(answer).resolves.toBe('dismiss')
    expect(onDontAskAgain).not.toHaveBeenCalled()
  })
})
