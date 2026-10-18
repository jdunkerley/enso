/** @file Every spec fails if the app asks Enso Cloud for anything (`cloudRequests`, `base.ts`). */
import { expect, test } from 'integration-test/base'
import { registerMocks } from 'integration-test/mock/registerMocks'

// Not `drivePage`: it would load the app, and this spec registers the mocks by hand to make its
// own request. Only the local mock is registered here, as in `localOnly.spec.ts`.
test('a request to Enso Cloud is blocked and recorded', async ({
  page,
  localApi,
  appConfig,
  cloudRequests,
}) => {
  const _ = { localApi }
  await registerMocks(page, {}, { appConfig })
  await page.goto('/')
  await expect(page.getByTestId('drive-view')).toBeVisible()
  const outcome = await page.evaluate(() =>
    fetch('https://mock/users/me').then(
      () => 'answered',
      () => 'blocked',
    ),
  )
  expect(outcome).toBe('blocked')
  expect(cloudRequests).toEqual(['GET https://mock/users/me'])
  // The fixture fails any test that leaves a cloud request recorded; this one made it on purpose.
  cloudRequests.splice(0)
})
