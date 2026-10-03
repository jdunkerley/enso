/**
 * @file The Vue agreements dialog: a legal gate, so its behaviour must stay exactly the React
 * `AgreementsModal`'s. It cannot be dismissed; it records the acceptance only once both documents
 * are ticked; each checkbox starts ticked when its document is unchanged since the last acceptance.
 */
import { useText } from '$/providers/text'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { describe, expect, test, vi } from 'vitest'
import AgreementsModal from '../AgreementsModal.vue'

const { getText } = useText()

const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')
const group = (name: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="group"]')].find((element) =>
    element.textContent?.includes(name),
  )!
const checkbox = (name: string) => group(name).querySelector<HTMLInputElement>('input')!
const button = (name: string) =>
  [...document.querySelectorAll<HTMLElement>('button')].find(
    (element) => element.textContent?.trim() === name,
  )!

async function setup(agreedToTos = false, agreedToPrivacyPolicy = false) {
  const userAgreed = vi.fn()
  const mounted = await mountWithProviders(AgreementsModal, {
    props: { agreedToTos, agreedToPrivacyPolicy, userAgreed },
  })
  await flushPromises()
  return { userAgreed, ...mounted }
}

describe('AgreementsModal', () => {
  test('has the title, text, checkboxes, links and button of the React dialog', async () => {
    await setup()
    const modal = byTestId('agreements-modal')!
    expect(modal).toBe(dialog())
    expect(modal.getAttribute('role')).toBe('dialog')
    expect(modal.querySelector('h2')!.textContent!.trim()).toBe(getText('licenseAgreementTitle'))
    // Named by its title, as react-aria names a dialog.
    const labelledBy = modal.getAttribute('aria-labelledby')!
    expect(document.getElementById(labelledBy)!.textContent!.trim()).toBe(
      getText('licenseAgreementTitle'),
    )
    expect(modal.textContent).toContain(getText('someAgreementsHaveBeenUpdated'))
    expect(byTestId('agreements-form')!.tagName).toBe('FORM')
    expect(group(getText('licenseAgreementCheckbox'))).toBeDefined()
    expect(group(getText('privacyPolicyCheckbox'))).toBeDefined()
    const links = [...modal.querySelectorAll<HTMLAnchorElement>('a')]
    expect(links.map((link) => [link.textContent!.trim(), link.getAttribute('href')])).toEqual([
      [getText('viewLicenseAgreement'), `${$config.HOST}/eula`],
      [getText('viewPrivacyPolicy'), `${$config.HOST}/privacy`],
    ])
    for (const link of links) expect(link.getAttribute('target')).toBe('_blank')
    expect(button(getText('accept'))).toBeDefined()
  })

  test('starts unticked when neither document was accepted', async () => {
    await setup()
    expect(checkbox(getText('licenseAgreementCheckbox')).checked).toBe(false)
    expect(checkbox(getText('privacyPolicyCheckbox')).checked).toBe(false)
  })

  test('starts with the unchanged document ticked', async () => {
    await setup(true, false)
    expect(checkbox(getText('licenseAgreementCheckbox')).checked).toBe(true)
    expect(checkbox(getText('privacyPolicyCheckbox')).checked).toBe(false)
  })

  test('cannot be dismissed: no close button, Escape and outside clicks do nothing', async () => {
    const { userAgreed } = await setup()
    const modal = dialog()!
    // The close button is rendered hidden, as React's `hideCloseButton` hides it.
    const closeButton = modal.querySelector('header button')
    expect(closeButton == null || closeButton.closest('.hidden') != null).toBe(true)
    // The overlay blocks pointer events to the page; click it as a user could.
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    await user.keyboard('{Escape}')
    await flushPromises()
    expect(dialog()).not.toBeNull()
    await user.click(byTestId('modal-dialog')!)
    await flushPromises()
    expect(dialog()).not.toBeNull()
    expect(userAgreed).not.toHaveBeenCalled()
  })

  test('accepting with nothing ticked shows both errors and records nothing', async () => {
    const { userAgreed } = await setup()
    await userEvent.setup().click(button(getText('accept')))
    await flushPromises()
    expect(userAgreed).not.toHaveBeenCalled()
    expect(dialog()).not.toBeNull()
    expect(dialog()!.textContent).toContain(getText('licenseAgreementCheckboxError'))
    expect(dialog()!.textContent).toContain(getText('privacyPolicyCheckboxError'))
  })

  test('accepting with only one ticked records nothing', async () => {
    const { userAgreed } = await setup()
    const user = userEvent.setup()
    await user.click(group(getText('licenseAgreementCheckbox')).querySelector('label')!)
    await user.click(button(getText('accept')))
    await flushPromises()
    expect(userAgreed).not.toHaveBeenCalled()
    expect(dialog()!.textContent).not.toContain(getText('licenseAgreementCheckboxError'))
    expect(dialog()!.textContent).toContain(getText('privacyPolicyCheckboxError'))
  })

  test('ticking both and accepting records the acceptance once, and closes', async () => {
    const { userAgreed } = await setup()
    const user = userEvent.setup()
    await user.click(group(getText('licenseAgreementCheckbox')).querySelector('label')!)
    await user.click(group(getText('privacyPolicyCheckbox')).querySelector('label')!)
    await user.click(button(getText('accept')))
    await flushPromises()
    expect(userAgreed).toHaveBeenCalledOnce()
    await vi.waitFor(() => expect(dialog()).toBeNull())
  })

  test('with both already ticked, accepting records it straight away', async () => {
    const { userAgreed } = await setup(true, true)
    await userEvent.setup().click(button(getText('accept')))
    await flushPromises()
    expect(userAgreed).toHaveBeenCalledOnce()
  })

  test('the checkboxes and Accept work from the keyboard, and focus stays in the dialog', async () => {
    const { userAgreed } = await setup()
    const modal = dialog()!
    // Focus moves into the dialog as it opens.
    expect(modal.contains(document.activeElement)).toBe(true)
    const user = userEvent.setup()
    const seen = new Set<Element>()
    for (let i = 0; i < 12; i += 1) {
      await user.tab()
      expect(modal.contains(document.activeElement)).toBe(true)
      // jsdom applies no styles, so the close button that `hidden` hides is reachable here.
      if (document.activeElement!.closest('.hidden') == null) seen.add(document.activeElement!)
    }
    // The two checkboxes, the two links and Accept.
    expect(seen.size).toBe(5)
    checkbox(getText('licenseAgreementCheckbox')).focus()
    await user.keyboard(' ')
    checkbox(getText('privacyPolicyCheckbox')).focus()
    await user.keyboard(' ')
    button(getText('accept')).focus()
    await user.keyboard('{Enter}')
    await flushPromises()
    expect(userAgreed).toHaveBeenCalledOnce()
  })
})
