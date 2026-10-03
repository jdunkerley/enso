/** @file Test the login flow. */
import { expect, test } from 'integration-test/base'

import { INVALID_PASSWORD, TEXT, VALID_EMAIL, VALID_PASSWORD } from '../actions'

// Reset storage state for this file to avoid being authenticated
test.use({ storageState: { cookies: [], origins: [] } })

test('sign up without organization id', async ({ loginPage }) => {
  await loginPage.goToPage
    .register()
    .registerThatShouldFail('invalid email', VALID_PASSWORD, VALID_PASSWORD, {
      assert: {
        emailError: TEXT.invalidEmailValidationError,
        passwordError: null,
        confirmPasswordError: null,
        formError: null,
      },
    })
    .registerThatShouldFail(VALID_EMAIL, INVALID_PASSWORD, INVALID_PASSWORD, {
      assert: {
        emailError: null,
        passwordError: TEXT.passwordValidationError,
        confirmPasswordError: null,
        formError: null,
      },
    })
    .registerThatShouldFail(VALID_EMAIL, VALID_PASSWORD, INVALID_PASSWORD, {
      assert: {
        emailError: null,
        passwordError: null,
        confirmPasswordError: TEXT.passwordMismatchError,
        formError: null,
      },
    })
    .register()
})

test('the email confirmation page is headed by its result', async ({ page, loginPage }) => {
  await loginPage.do(async () => {
    await page.goto('/confirmation?email=user%40example.com&verification_code=123')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      TEXT.confirmRegistrationTitleSuccess,
    )
    await expect(page.locator('h1:empty')).toHaveCount(0)
  })
})
