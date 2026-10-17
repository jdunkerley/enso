import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test as setup } from './base'

const __dirname = dirname(fileURLToPath(import.meta.url))
const authFilePath = join(__dirname, '../playwright/.auth/user.json')

setup('authenticate', async ({ page, loginPage }) => {
  // The IDE is local-only: there is no login form, and the offline session needs none. The state
  // file is still written, since both integration projects name it.
  await loginPage.loginIfNeeded()
  await page.context().storageState({ path: authFilePath })
})
