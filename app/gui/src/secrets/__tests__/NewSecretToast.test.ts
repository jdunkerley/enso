/** @file The New secret toast: the path, and Copy puts it on the clipboard. */
import { useText } from '$/providers/text'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { expect, test, vi } from 'vitest'
import NewSecretToast from '../NewSecretToast.vue'

const { getText } = useText()

test('shows the path, and Copy copies it', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  const user = userEvent.setup()
  const { wrapper } = await mountWithProviders(NewSecretToast, { props: { path: 'secret://x' } })
  vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(writeText)
  expect(wrapper.text()).toContain('secret://x')
  await user.click(wrapper.get('button').element)
  await flushPromises()
  expect(writeText).toHaveBeenCalledExactlyOnceWith('secret://x')
  expect(wrapper.get('button').text()).toBe(getText('copied'))
})
