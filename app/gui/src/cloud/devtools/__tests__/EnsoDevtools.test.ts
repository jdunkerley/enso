/**
 * @file The Enso devtools (#172): the button opens the panel from the mouse and the keyboard, and
 * Escape closes it; the feature flags, the plan override, the version checker and the paywall
 * toggles write their stores; the overrides list shows what is overridden and resets it; and the
 * local storage section edits and deletes entries.
 */
import EnsoDevtools from '$/cloud/devtools/EnsoDevtools.vue'
import { useIsFeatureUnderPaywall } from '$/composables/paywall'
import { useDevtoolsStore } from '$/providers/devTools'
import { flagsStore, getFeatureFlag, setFeatureFlags } from '$/providers/featureFlags'
import { useText } from '$/providers/text'
import LocalStorage from '$/utils/LocalStorage'
import { createTestQueryClient, mountWithProviders } from '$/utils/testing/mountWithProviders'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { Plan } from 'enso-common/src/services/Backend'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { effectScope } from 'vue'
import { z } from 'zod'

const auth = vi.hoisted(() => ({
  session: { user: { plan: 'free' } } as unknown,
  isAuthDisabled: false,
}))
vi.mock('$/providers/auth', async () => {
  const { reactive } = await import('vue')
  const store = reactive(auth)
  return { useAuth: () => store }
})

declare module '$/utils/LocalStorage' {
  interface LocalStorageData {
    readonly devtoolsTestEntry: { readonly count: number }
  }
}
LocalStorage.registerKey('devtoolsTestEntry', { schema: z.object({ count: z.number() }) })

const { getText } = useText()
const INITIAL_FLAGS = flagsStore.getState().featureFlags

let portalRoot: HTMLElement
beforeEach(() => {
  portalRoot = document.createElement('div')
  portalRoot.id = 'enso-portal-root'
  document.body.appendChild(portalRoot)
  // Off by default outside development and Electron, which the overrides list would report.
  setFeatureFlags({ enableCloudExecution: true })
  // Shown by default in development builds only.
  useDevtoolsStore().showEnsoDevtools = true
})
afterEach(() => {
  portalRoot.remove()
  setFeatureFlags(INITIAL_FLAGS)
  const devtools = useDevtoolsStore()
  devtools.showEnsoDevtools = false
  devtools.showVersionChecker = false
  for (const feature of Object.keys(devtools.paywallFeatures)) {
    devtools.setPaywallFeature(feature as keyof typeof devtools.paywallFeatures, null)
  }
  LocalStorage.getInstance().delete('devtoolsTestEntry')
})

const openButton = () =>
  document.querySelector<HTMLButtonElement>(
    `button[aria-label="${getText('ensoDevtoolsButtonLabel')}"]`,
  )
const panel = () => document.querySelector<HTMLElement>('[data-testid="enso-devtools"]')
const status = () => document.querySelector<HTMLElement>('[data-testid="enso-dev-status"]')
const switchNamed = (name: string) =>
  panel()!.querySelector<HTMLInputElement>(`input[role="switch"][name="${name}"]`)!
const buttonIn = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll('button')].find((button) => button.textContent.trim() === text)

async function openPanel() {
  const user = userEvent.setup()
  await mountWithProviders(EnsoDevtools)
  await user.click(openButton()!)
  await vi.waitFor(() => expect(panel()).not.toBeNull())
  return user
}

describe('EnsoDevtools', () => {
  test('the button opens the panel from the keyboard; Escape closes it and returns focus', async () => {
    const user = userEvent.setup()
    await mountWithProviders(EnsoDevtools)
    expect(status()).toBeNull()
    openButton()!.focus()
    await user.keyboard('{Enter}')
    await vi.waitFor(() => expect(panel()).not.toBeNull())
    expect(panel()!.getAttribute('role')).toBe('dialog')
    expect(panel()!.contains(document.activeElement)).toBe(true)
    expect(panel()!.querySelector('h1')?.textContent.trim()).toBe(
      getText('ensoDevtoolsPopoverHeading'),
    )
    await user.keyboard('{Escape}')
    await vi.waitFor(() => expect(panel()).toBeNull())
    expect(document.activeElement).toBe(openButton())
  })

  test('a feature flag switch sets the flag, and the overrides list resets it', async () => {
    const user = await openPanel()
    expect(getFeatureFlag('showDeveloperIds')).toBe(false)
    await user.click(switchNamed('showDeveloperIds'))
    expect(getFeatureFlag('showDeveloperIds')).toBe(true)
    await vi.waitFor(() => expect(status()?.textContent).toContain(getText('showingDeveloperIds')))
    // The panel is modal: close it before reaching the page.
    await user.keyboard('{Escape}')
    await vi.waitFor(() => expect(panel()).toBeNull())
    await user.click(
      status()!.querySelector<HTMLButtonElement>(`button[aria-label="${getText('reset')}"]`)!,
    )
    expect(getFeatureFlag('showDeveloperIds')).toBe(false)
    await vi.waitFor(() => expect(status()).toBeNull())
  })

  test('a number flag is written once it is valid', async () => {
    const user = await openPanel()
    const input = panel()!.querySelector<HTMLInputElement>('input[name="listDirectoryPageSize"]')!
    await user.clear(input)
    // Empty is not a page size: the flag keeps its value.
    expect(getFeatureFlag('listDirectoryPageSize')).toBe(INITIAL_FLAGS.listDirectoryPageSize)
    await user.type(input, '25')
    expect(getFeatureFlag('listDirectoryPageSize')).toBe(25)
    await vi.waitFor(() =>
      expect(status()?.textContent).toContain(getText('willFetchUpToXAssetsPerPage', 25)),
    )
  })

  test('the plan override is set by the radios, and reset', async () => {
    const user = await openPanel()
    const team = panel()!.querySelector<HTMLInputElement>(`input[type="radio"][value="team"]`)!
    await user.click(team)
    expect(getFeatureFlag('developerPlanOverride')).toBe(Plan.team)
    await vi.waitFor(() =>
      expect(status()?.textContent).toContain(getText('planOverriddenToX', getText('team'))),
    )
    await user.click(buttonIn(panel()!, getText('reset'))!)
    expect(getFeatureFlag('developerPlanOverride')).toBeUndefined()
  })

  test('the plan override is offered only when signed in', async () => {
    const session = auth.session
    auth.session = null
    try {
      await openPanel()
      expect(panel()!.querySelector('input[type="radio"]')).toBeNull()
    } finally {
      auth.session = session
    }
  })

  test('the version checker switch forces the checker on and off', async () => {
    const user = await openPanel()
    await user.click(switchNamed('enableVersionChecker'))
    expect(useDevtoolsStore().showVersionChecker).toBe(true)
    await vi.waitFor(() =>
      expect(status()?.textContent).toContain(getText('versionCheckerEnabled')),
    )
    await user.click(switchNamed('enableVersionChecker'))
    expect(useDevtoolsStore().showVersionChecker).toBe(false)
  })

  test('a paywall switch forces the feature on, and off leaves it to the plan', async () => {
    const user = await openPanel()
    const scope = effectScope()
    const isFeatureUnderPaywall = scope.run(() => useIsFeatureUnderPaywall())!
    // The free plan has no scheduler: the switch is fully off, not half-way.
    expect(isFeatureUnderPaywall('scheduler')).toBe(true)
    await user.click(switchNamed('scheduler'))
    expect(useDevtoolsStore().paywallFeatures.scheduler.isForceEnabled).toBe(true)
    expect(isFeatureUnderPaywall('scheduler')).toBe(false)
    await user.click(switchNamed('scheduler'))
    expect(useDevtoolsStore().paywallFeatures.scheduler.isForceEnabled).toBeNull()
    expect(isFeatureUnderPaywall('scheduler')).toBe(true)
    scope.stop()
  })

  test('"Hide Devtools" hides the button, and the overrides list stays', async () => {
    const user = await openPanel()
    await user.click(switchNamed('enableMultitabs'))
    await user.click(buttonIn(panel()!, getText('hideDevtools'))!)
    expect(useDevtoolsStore().showEnsoDevtools).toBe(false)
    await vi.waitFor(() => expect(openButton()).toBeNull())
    expect(status()?.textContent).toContain(getText('multitabsEnabled'))
  })

  test('"Clear cache and reload" clears the query cache with its persisted copy', async () => {
    const queryClient = createTestQueryClient()
    const clearWithPersister = vi.fn(async () => {})
    Object.defineProperty(queryClient, 'clearWithPersister', { value: clearWithPersister })
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    try {
      const user = userEvent.setup()
      await mountWithProviders(EnsoDevtools, { queryClient })
      await user.click(openButton()!)
      await vi.waitFor(() => expect(panel()).not.toBeNull())
      await user.click(buttonIn(panel()!, getText('clearCacheAndReload'))!)
      await flushPromises()
      expect(clearWithPersister).toHaveBeenCalledOnce()
      expect(reload).toHaveBeenCalledOnce()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  test('local storage: an entry is edited as JSON against its schema, and deleted', async () => {
    const storage = LocalStorage.getInstance()
    storage.set('devtoolsTestEntry', { count: 1 })
    const user = await openPanel()
    const row = () =>
      panel()!.querySelector<HTMLElement>(
        '[data-testid="devtools-local-storage-devtoolsTestEntry"]',
      )!
    await user.click(row().querySelector<HTMLButtonElement>('button[aria-label="Edit"]')!)
    const dialog = await vi.waitFor(() => {
      const element = document.querySelector<HTMLElement>('[role="dialog"]:not([data-testid])')
      expect(element).not.toBeNull()
      return element!
    })
    const input = dialog.querySelector<HTMLInputElement>('input[name="value"]')!
    expect(JSON.parse(input.value)).toEqual({ count: 1 })
    await user.clear(input)
    await user.type(input, '{{"count": "two"}')
    await user.click(buttonIn(dialog, getText('submit'))!)
    await vi.waitFor(() =>
      expect(dialog.textContent).toContain('Invalid JSON or value does not match schema'),
    )
    expect(storage.get('devtoolsTestEntry')).toEqual({ count: 1 })
    await user.clear(input)
    await user.type(input, '{{"count": 2}')
    await user.click(buttonIn(dialog, getText('submit'))!)
    await vi.waitFor(() => expect(storage.get('devtoolsTestEntry')).toEqual({ count: 2 }))
    await vi.waitFor(() => expect(dialog.isConnected).toBe(false))
    await user.click(
      row().querySelector<HTMLButtonElement>(`button[aria-label="${getText('delete')}"]`)!,
    )
    expect(storage.get('devtoolsTestEntry')).toBeUndefined()
  })
})
