/** @file Test the user settings tab. */
import { CLOUD_ONLY, test } from 'integration-test/base'

test.skip(true, CLOUD_ONLY)

const DATA_LINK_NAME = 'a data link'

test('data link editor', async ({ drivePage }) => {
  await drivePage.goToCategory
    .cloud()
    .openDataLinkModal()
    .withNameInput((input) => input.fill(DATA_LINK_NAME))
})
