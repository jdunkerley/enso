/** @file The secrets key reminder toast: its two buttons call back. */
import { useText } from '$/providers/text'
import SecretsKeyReminderToast from '$/secrets/SecretsKeyReminderToast.vue'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { h } from 'vue'

const { getText } = useText()

test('Rotate now and Remind me in a month each call back', async () => {
  const onRotate = vi.fn()
  const onSnooze = vi.fn()
  await mountWithProviders(() => h(SecretsKeyReminderToast, { onRotate, onSnooze }))
  expect(document.body.textContent).toContain(getText('secretsKeyOld'))
  const user = userEvent.setup()
  const press = (name: string) =>
    [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === name)
  await user.click(press(getText('secretsRotateNow'))!)
  expect(onRotate).toHaveBeenCalledOnce()
  expect(onSnooze).not.toHaveBeenCalled()
  await user.click(press(getText('secretsRemindInAMonth'))!)
  expect(onSnooze).toHaveBeenCalledOnce()
})
