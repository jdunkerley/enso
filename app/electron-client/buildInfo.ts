import type { UpdateMode } from 'enso-common/src/updater'

/** Set by the build (`update_mode` in the retired build CLI's `web.rs`); `manual` by default. */
const updates: UpdateMode = process.env.ENSO_IDE_UPDATES === 'auto' ? 'auto' : 'manual'

export default {
  version: process.env.ENSO_IDE_VERSION ?? '0.0.0-dev',
  commit: process.env.ENSO_IDE_COMMIT_HASH ?? '<snapshot>',
  updates,
}
