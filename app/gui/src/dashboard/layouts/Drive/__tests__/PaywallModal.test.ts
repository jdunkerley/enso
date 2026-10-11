/** @file The paywall dialog that a locked context-menu entry opens on the modal stack. */
import PaywallModal from '#/layouts/Drive/PaywallModal.vue'
import { SUBSCRIBE_PATH } from '$/appUtils'
import ModalHost from '$/components/ModalHost/ModalHost.vue'
import { useModals } from '$/providers/modals'
import { useText } from '$/providers/text'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { expect, test, vi } from 'vitest'

const { getText } = useText()

test('on the modal stack, it opens at once and leaves the stack once closed', async () => {
  await mountWithProviders(ModalHost)
  const modals = useModals()
  modals.open(PaywallModal, { feature: 'uploadToCloud' })
  await flushPromises()
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
  expect(dialog?.textContent).toContain(getText('uploadToCloudFeatureLabel'))
  expect(dialog?.textContent).toContain(getText('uploadToCloudFeatureDescription'))
  const upgrade = [...document.querySelectorAll<HTMLAnchorElement>('a')].find(
    (element) => element.textContent.trim() === getText('upgradeTo', getText('soloPlanName')),
  )
  expect(upgrade?.getAttribute('href')).toBe(`${SUBSCRIBE_PATH}?plan=solo`)
  await userEvent.setup().keyboard('{Escape}')
  await vi.waitFor(() => expect(modals.stack.value).toHaveLength(0))
  expect(document.querySelector('[role="dialog"]')).toBeNull()
})
