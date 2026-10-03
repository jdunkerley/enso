/** @file Test the login flow. */
import { expect, test } from 'integration-test/base'

import { INVALID_PASSWORD, TEXT, VALID_EMAIL, VALID_PASSWORD } from '../actions'

/**
 * Set in `localStorage`, it makes the mocked Cognito (`src/authentication/cognito.mock.ts`) ask for a
 * one-time code after the password, and is the right code.
 */
const MOCK_TOTP_CODE_KEY = 'mock_totp_code'
const ONE_TIME_CODE = '123456'

// Reset storage state for this file to avoid being authenticated
test.use({ storageState: { cookies: [], origins: [] } })

test('login screen', async ({ loginPage }) => {
  await loginPage
    .loginThatShouldFail('invalid email', VALID_PASSWORD, {
      assert: {
        emailError: TEXT.invalidEmailValidationError,
        passwordError: null,
        formError: null,
      },
    })
    // Technically it should not be allowed, but
    .login(VALID_EMAIL, INVALID_PASSWORD)
    .withDriveView(async (driveView) => {
      await expect(driveView).toBeVisible()
    })
})

test('a wrong one-time code says so, and is cleared for another try', async ({
  page,
  loginPage,
}) => {
  await loginPage.do(async () => {
    await page.evaluate(
      ([key, code]) => localStorage.setItem(key!, code!),
      [MOCK_TOTP_CODE_KEY, ONE_TIME_CODE],
    )
    await page.getByPlaceholder(TEXT.emailPlaceholder).fill(VALID_EMAIL)
    await page.getByPlaceholder(TEXT.passwordPlaceholder).fill(VALID_PASSWORD)
    await page.getByRole('button', { name: TEXT.login, exact: true }).click()
    await expect(page.getByText(TEXT.enterTotp)).toBeVisible()

    const otpInput = page.getByTestId('otp-input')
    // One box per character (Reka's `PinInput`, which adds a hidden input of its own).
    const boxes = otpInput.getByRole('textbox', { name: /^pin input/ })
    await boxes.first().click()
    // A complete code submits itself.
    await page.keyboard.type('000000')
    await expect(otpInput.getByText(TEXT.wrongOneTimeCode)).toBeVisible()
    await expect(boxes).toHaveCount(ONE_TIME_CODE.length)
    for (const box of await boxes.all()) await expect(box).toHaveValue('')
    await expect(boxes.first()).toBeFocused()

    await page.keyboard.type(ONE_TIME_CODE)
    await expect(page.getByText(TEXT.loginToYourAccount)).toBeHidden()
  })
})
