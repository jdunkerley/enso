/**
 * @file The paywall pieces (`src/cloud/billing/paywall/`): the screen, the alert, the button that
 * opens the dialog, and the dialog on the modal stack (for menus' paywalled entries), with the plan
 * each feature needs and where its upgrade button leads.
 */
import { SUBSCRIBE_PATH } from '$/appUtils'
import PaywallAlert from '$/cloud/billing/paywall/PaywallAlert.vue'
import PaywallDialogButton from '$/cloud/billing/paywall/PaywallDialogButton.vue'
import PaywallModal from '$/cloud/billing/paywall/PaywallModal.vue'
import PaywallScreen from '$/cloud/billing/paywall/PaywallScreen.vue'
import ModalHost from '$/components/ModalHost/ModalHost.vue'
import { useModals } from '$/providers/modals'
import { useText } from '$/providers/text'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { describe, expect, test, vi } from 'vitest'

const { getText } = useText()

const link = (name: string) =>
  [...document.querySelectorAll<HTMLAnchorElement>('a')].find(
    (element) => element.textContent.trim() === name,
  )

describe('paywall', () => {
  test('the screen names the plan, what it brings, and links to the subscription page', async () => {
    await mountWithProviders(PaywallScreen, { props: { feature: 'scheduler' } })
    const text = document.body.textContent
    expect(text).toContain(getText('paywallAvailabilityLevel', getText('teamPlanName')))
    expect(document.querySelector('h2')?.textContent.trim()).toBe(getText('paywallScreenTitle'))
    expect(text).toContain(getText('schedulerFeatureDescription'))
    const bulletPoints = getText('schedulerFeatureBulletPoints').split(';')
    expect(document.querySelectorAll('li')).toHaveLength(bulletPoints.length)
    const upgrade = link(getText('upgradeTo', getText('teamPlanName')))
    expect(upgrade?.getAttribute('href')).toBe(`${SUBSCRIBE_PATH}?plan=team`)
  })

  test('the alert gives its label, and offers the enterprise plan as "Contact Sales"', async () => {
    await mountWithProviders(PaywallAlert, {
      props: { feature: 'inviteUserFull', label: 'Two seats left' },
    })
    expect(document.body.textContent).toContain('Two seats left')
    expect(link(getText('contactSales'))?.getAttribute('href')).toMatch(/\/contact$/)
  })

  test("the dialog button opens the feature's dialog, and Escape closes it", async () => {
    await mountWithProviders(PaywallDialogButton, {
      props: { feature: 'inviteUserFull' },
      attrs: { variant: 'link', showIcon: false },
    })
    const trigger = document.querySelector('button')
    expect(trigger?.textContent.trim()).toBe(getText('upgradeTo', getText('enterprisePlanName')))
    const user = userEvent.setup()
    await user.click(trigger!)
    await flushPromises()
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
    expect(dialog?.textContent).toContain(getText('inviteUserFullFeatureLabel'))
    expect(dialog?.textContent).toContain(getText('inviteUserFullFeatureDescription'))
    await user.keyboard('{Escape}')
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
    expect(document.activeElement).toBe(trigger)
  })

  test('on the modal stack, it opens at once and leaves the stack once closed', async () => {
    await mountWithProviders(ModalHost)
    const modals = useModals()
    modals.open(PaywallModal, { feature: 'uploadToCloud' })
    await flushPromises()
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
    expect(dialog?.textContent).toContain(getText('uploadToCloudFeatureLabel'))
    expect(dialog?.textContent).toContain(getText('uploadToCloudFeatureDescription'))
    expect(link(getText('upgradeTo', getText('soloPlanName')))?.getAttribute('href')).toBe(
      `${SUBSCRIBE_PATH}?plan=solo`,
    )
    await userEvent.setup().keyboard('{Escape}')
    await vi.waitFor(() => expect(modals.stack.value).toHaveLength(0))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
})
