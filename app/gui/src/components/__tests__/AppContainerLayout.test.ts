/**
 * @file The app container's layout mounts the modals the cloud contributes (#84) exactly when its
 * data loader says, with the props it computed; without contributions it shows none.
 */
import AppContainerLayout from '$/components/AppContainerLayout.vue'
import {
  contributeAppContainerModals,
  loadAppContainerModals,
  resetLayoutContributions,
} from '$/providers/layoutContributions'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { defineComponent, h } from 'vue'

const logEvent = vi.hoisted(() => vi.fn())

vi.mock('$/providers/backends', async () => {
  const { mockBackends } = await import('$/utils/testing/mountWithProviders')
  return { useBackends: () => mockBackends({ remoteBackend: { logEvent } }) }
})

/** A stand-in modal that shows its name and props. */
const stub = (name: string) =>
  defineComponent({
    inheritAttrs: false,
    setup:
      (_, { attrs }) =>
      () =>
        h('div', { 'data-testid': name }, JSON.stringify(attrs)),
  })

const MODALS = {
  SetupOrganizationModal: stub('setup'),
  TrialEndedModal: stub('trial'),
  PlanDowngradedModal: stub('downgraded'),
  AcceptInvitationModal: stub('invitation'),
}

const NONE = {
  shouldSetupOrganization: false,
  trialEndedModalProps: undefined,
  planDowngradedModalProps: undefined,
  acceptInvitationModalProps: undefined,
}

const shown = (id: string) => document.querySelector(`[data-testid="${id}"]`)?.textContent ?? null

beforeEach(() => {
  resetLayoutContributions()
  logEvent.mockReset()
})

describe('AppContainerLayout', () => {
  test('shows each contributed modal when asked, with its props', async () => {
    contributeAppContainerModals(async () => MODALS)
    await loadAppContainerModals()
    const { setProps } = await mountWithProviders(AppContainerLayout, { props: NONE })
    for (const id of ['setup', 'trial', 'downgraded', 'invitation']) expect(shown(id)).toBeNull()
    await setProps({
      shouldSetupOrganization: true,
      trialEndedModalProps: { subscriptionId: 'subscription-1' },
      planDowngradedModalProps: { deletionDeadlineTimestamp: 42 },
      acceptInvitationModalProps: { invitation: { organizationName: 'Acme' } },
    })
    expect(shown('setup')).toBe('{}')
    expect(JSON.parse(shown('trial')!)).toEqual({ subscriptionId: 'subscription-1' })
    expect(JSON.parse(shown('downgraded')!)).toEqual({ deletionDeadlineTimestamp: 42 })
    expect(JSON.parse(shown('invitation')!)).toEqual({ invitation: { organizationName: 'Acme' } })
  })

  test('shows none without contributions (a build without the cloud)', async () => {
    await mountWithProviders(AppContainerLayout, {
      props: { ...NONE, shouldSetupOrganization: true },
    })
    expect(shown('setup')).toBeNull()
  })

  test('logs opening and closing the app, as before', async () => {
    const { unmount } = await mountWithProviders(AppContainerLayout, { props: NONE })
    expect(logEvent).toHaveBeenCalledWith('open_app')
    unmount()
    expect(logEvent).toHaveBeenCalledWith('close_app')
  })
})
