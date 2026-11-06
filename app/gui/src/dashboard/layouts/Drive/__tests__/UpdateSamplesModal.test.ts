/** @file The update confirmation says which samples change, and how each one's edits are kept. */
import type { SampleEntry } from '#/layouts/Drive/samples'
import UpdateSamplesModal from '#/layouts/Drive/UpdateSamplesModal.vue'
import {
  byTestId,
  mountWithProviders,
  usePrimitiveTestEnvironment,
} from '$/components/__tests__/mountWithProviders'
import ModalHost from '$/components/ModalHost/ModalHost.vue'
import { createModalsStore } from '$/providers/modals'
import { flushPromises } from '@vue/test-utils'
import { describe, expect, test } from 'vitest'
import { h } from 'vue'

usePrimitiveTestEnvironment()

const sample = (name: string, route: SampleEntry['route']): SampleEntry =>
  ({
    name,
    path: `C:/projects/Samples/${name}`,
    state: 'updateAvailable',
    route,
    copyName: route === 'copy' ? `${name}_edited_2026_11_06` : null,
  }) as SampleEntry

/** The text of `element`, with its white space collapsed. */
const textOf = (element: Element | null | undefined) =>
  (element?.textContent ?? '').replace(/\s+/g, ' ').trim()

async function ask(samples: readonly SampleEntry[]) {
  const store = createModalsStore()
  mountWithProviders(() => h(ModalHost, { store }))
  void store.ask(UpdateSamplesModal, { samples })
  await flushPromises()
  const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]')
  const routes = [...(dialog?.querySelectorAll('[data-testid="update-sample-route"]') ?? [])].map(
    textOf,
  )
  return { title: textOf(dialog?.querySelector('h2')), routes }
}

describe('UpdateSamplesModal', () => {
  test('names one sample, and the copy it keeps', async () => {
    const { title, routes } = await ask([sample('Sales_Overview', 'copy')])
    expect(title).toBe("Update 'Sales_Overview'?")
    expect(routes).toEqual(["Your edited copy will be kept as 'Sales_Overview_edited_2026_11_06'."])
    expect(textOf(byTestId('alert-dialog-confirm'))).toBe('Update')
  })

  test('says a versioned sample stays in version history', async () => {
    const { routes } = await ask([sample('Orders', 'version')])
    expect(routes).toEqual(['Your current version stays in version history.'])
  })

  test('lists several samples, each with its route', async () => {
    const { title, routes } = await ask([
      sample('Sales_Overview', 'copy'),
      sample('Orders', 'version'),
    ])
    expect(title).toBe('Update the samples?')
    expect(routes).toEqual([
      "Sales_Overview: Your edited copy will be kept as 'Sales_Overview_edited_2026_11_06'.",
      'Orders: Your current version stays in version history.',
    ])
  })
})
