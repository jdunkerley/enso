/** @file The protected layout: the page under it shows, with no access check or redirect. */
import ProtectedLayout from '$/components/ProtectedLayout.vue'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import { flushPromises } from '@vue/test-utils'
import { expect, test, vi } from 'vitest'
import { h, type Component } from 'vue'

vi.mock('$/composables/appTitle', () => ({ useAppTitle: () => {} }))
const Page: Component = { render: () => h('div', { 'data-testid': 'page' }) }

test('shows the page, marked as signed in, for a route with no access level', async () => {
  await mountWithProviders(ProtectedLayout, {
    routes: [{ path: '/', component: Page }],
  })
  await flushPromises()
  expect(document.querySelector('[data-testid="page"]')).not.toBeNull()
  expect(document.querySelector('[data-testid="after-auth-layout"]')).not.toBeNull()
  expect(document.querySelector('[data-testid="content-not-allowed"]')).toBeNull()
})
