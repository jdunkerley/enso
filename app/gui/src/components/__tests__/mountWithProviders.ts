/**
 * @file A minimal mount helper for the Vue primitives' component tests.
 *
 * #81 is adding a shared `mountWithProviders`; until it lands on this branch this local one does
 * what the primitives need: the `#enso-portal-root` element that `index.html` provides (overlays
 * teleport into it), attaching to the document so that focus works, and unmounting after each test
 * so that a failed assertion does not leave an open overlay behind for the next one. The
 * primitives need no other providers: text comes from the global `useText`.
 */
import { enableAutoUnmount, mount } from '@vue/test-utils'
import { afterEach, beforeEach } from 'vitest'
import { defineComponent, h, type Component, type VNodeChild } from 'vue'

/** Register the portal root and auto-unmount for every test in the calling file. */
export function usePrimitiveTestEnvironment() {
  const env = { portalRoot: undefined as unknown as HTMLElement }
  enableAutoUnmount(afterEach)
  beforeEach(() => {
    env.portalRoot = document.createElement('div')
    env.portalRoot.id = 'enso-portal-root'
    env.portalRoot.className = 'enso-portal-root'
    document.body.appendChild(env.portalRoot)
  })
  afterEach(() => {
    env.portalRoot.remove()
  })
  return env
}

/** Mount a render function, attached to the document. */
export function mountWithProviders(render: () => VNodeChild) {
  const host: Component = defineComponent({ setup: () => render })
  return mount(host, { attachTo: document.body })
}

/** Query the whole document (overlays are teleported out of the mounted tree). */
export const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)

export { h }
