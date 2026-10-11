/**
 * @file Billing and plans, against the mocked cloud (#88): the subscription page's checkout for
 * Team (seats chosen in a dialog) and Solo (confirmed), each opening Stripe's page in a new window
 * and then waiting on the payments success page for the new plan; the Billing settings tab opening
 * the Stripe customer portal; and a paywalled menu entry opening the paywall dialog.
 */
import { expect, test, type Page } from 'integration-test/base'

import { Plan } from 'enso-common/src/services/Backend'
import { TEXT } from '../actions'

/** Stripe's pages, which the app opens in a new window: answer them without the network. */
async function mockStripe(page: Page) {
  await page
    .context()
    .route(/^https?:\/\/(?:billing\.)?stripe\.com\//, (route) =>
      route.fulfill({ contentType: 'text/html', body: '<title>Stripe</title>' }),
    )
}

/** Go to the subscription page through the user menu's "Upgrade Plan". */
async function openSubscribePage(page: Page) {
  await page
    .getByTestId('user-menu')
    .getByRole('button', { name: TEXT.upgradePlanShortcut })
    .click()
  await expect(page.getByRole('heading', { name: TEXT.subscribeTitle })).toBeVisible()
}

test.describe('on the free plan', () => {
  test.use({ setupApi: { cloud: (cloudApi) => cloudApi.setPlan(Plan.free) } })

  test('subscribe to Team: seats, Stripe in a new window, then the new plan', async ({
    drivePage,
    cloudApi,
    page,
  }) => {
    await mockStripe(page)
    await drivePage.openUserMenu()
    await openSubscribePage(page)
    const calls = cloudApi.trackCalls()
    await page.getByRole('button', { name: TEXT.teamPlanUpgradeLabel }).click()
    const dialog = page.getByRole('dialog', { name: 'Upgrade to Team' })
    await expect(dialog).toBeVisible()
    const seats = dialog.getByRole('spinbutton')
    await expect(seats).toHaveValue('1')
    await seats.fill('3')
    await expect(dialog.getByText('$450.00')).toBeVisible()
    const popup = page.waitForEvent('popup')
    await dialog.getByRole('button', { name: TEXT.subscribeSubmit }).click()
    expect((await popup).url()).toBe('http://stripe.com/checkout/session')
    await expect(page.getByTestId('toast-host')).toContainText(TEXT['payments.success'])
    await expect(page).toHaveURL(/\/$/)
    expect(calls.createCheckoutSession).toEqual([{ price: Plan.team, quantity: 3, interval: 12 }])
  })

  test('subscribe to Solo: confirm, then Stripe in a new window', async ({
    drivePage,
    cloudApi,
    page,
  }) => {
    await mockStripe(page)
    await drivePage.openUserMenu()
    await openSubscribePage(page)
    const calls = cloudApi.trackCalls()
    await page.getByRole('button', { name: TEXT.soloPlanUpgradeLabel }).click()
    const confirm = page.getByRole('alertdialog')
    await expect(confirm).toContainText(TEXT.stripeRedirectAlert)
    const popup = page.waitForEvent('popup')
    await confirm.getByRole('button', { name: TEXT.goToStripe }).click()
    expect((await popup).url()).toBe('http://stripe.com/checkout/session')
    await expect(page.getByTestId('toast-host')).toContainText(TEXT['payments.success'])
    expect(calls.createCheckoutSession).toEqual([{ price: Plan.solo, quantity: 1, interval: 12 }])
  })

  test('a paywalled menu entry opens the paywall dialog', async ({ drivePage, page }) => {
    await drivePage.goToCategory
      .local()
      .driveTable.rightClickRow(0)
      .contextMenu.exportToCloud()
      .do(async () => {
        // The dialog is found by its title's text, not by an accessible name (#156, ruling 11).
        const dialog = page.getByRole('dialog').filter({ hasText: TEXT.uploadToCloudFeatureLabel })
        await expect(dialog).toBeVisible()
        await expect(
          dialog.getByRole('link', { name: `Upgrade to ${TEXT.soloPlanName}` }),
        ).toHaveAttribute('href', '/subscribe?plan=solo')
        await page.keyboard.press('Escape')
        await expect(dialog).toBeHidden()
      })
  })
})

test('the Billing settings tab opens the customer portal in a new window', async ({
  drivePage,
  cloudApi,
  page,
}) => {
  await mockStripe(page)
  const calls = cloudApi.trackCalls()
  await drivePage.goToPage
    .settings()
    .goToSettingsTab.billingAndPlans()
    .do(async () => {
      const popup = page.waitForEvent('popup')
      await page.getByRole('button', { name: TEXT.openBillingPage }).click()
      expect((await popup).url()).toBe(cloudApi.customerPortalSessionUrl)
      expect(calls.createCustomerPortalSession).toHaveLength(1)
    })
})
