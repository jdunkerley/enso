/**
 * @file The toast shown while the JDK AOT cache trains, faked through the mocked Electron API
 * (`registerMocks`): a lasting toast with a spinner, then "Engine ready" or the failure. With
 * `PR_SCREENSHOT_DIR` set, each state is also saved for the PR.
 */
import { expect, test, type Page } from 'integration-test/base'
import { setJvmAotTrainingStatus } from 'integration-test/mock/registerMocks'
import { TEXT } from '../actions'

const toast = (page: Page) => page.getByTestId('toast')

async function screenshot(page: Page, name: string) {
  const dir = process.env.PR_SCREENSHOT_DIR
  if (!dir) return
  // The toast's own slide-in, not its timer bar's animation, which runs until it closes.
  await toast(page).evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished)),
  )
  const box = await toast(page).boundingBox()
  if (box == null) return
  await page.screenshot({
    path: `${dir}/${name}.png`,
    clip: { x: box.x - 24, y: 0, width: box.width + 48, height: box.y + box.height + 16 },
  })
}

test('no toast when nothing trains', async ({ drivePage, page }) => {
  await drivePage
  await expect(page.getByText(TEXT.jvmAotTrainingToast)).toHaveCount(0)
})

test('a training shows a lasting toast, then "Engine ready"', async ({ drivePage, page }) => {
  await drivePage
  await setJvmAotTrainingStatus(page, 'training')
  await expect(toast(page)).toHaveText(TEXT.jvmAotTrainingToast)
  await expect(toast(page).getByLabel('close')).toBeVisible()
  // That it does not close by itself is unit-tested (`jvmAotTrainingToast.test.ts`).
  await screenshot(page, 'aot-training')
  await setJvmAotTrainingStatus(page, 'trained')
  await expect(toast(page)).toHaveText(TEXT.jvmAotTrainedToast)
  await screenshot(page, 'aot-trained')
  // It closes by itself.
  await expect(toast(page)).toHaveCount(0, { timeout: 15_000 })
})

test('a failed training says so, until closed', async ({ drivePage, page }) => {
  await drivePage
  await setJvmAotTrainingStatus(page, 'training')
  await expect(toast(page)).toHaveText(TEXT.jvmAotTrainingToast)
  await setJvmAotTrainingStatus(page, 'failed')
  await expect(toast(page)).toHaveText(TEXT.jvmAotTrainingFailedToast)
  await screenshot(page, 'aot-failed')
  await toast(page).getByLabel('close').click()
  await expect(toast(page)).toHaveCount(0)
})

test.describe('a window that loads mid-training', () => {
  test.use({ jvmAotTrainingStatus: 'training' })

  test('shows the training toast', async ({ drivePage, page }) => {
    await drivePage
    await expect(toast(page)).toHaveText(TEXT.jvmAotTrainingToast)
  })
})
