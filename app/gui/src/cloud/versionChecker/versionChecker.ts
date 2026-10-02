/**
 * @file Whether the "new version available" check runs (#83): in the desktop app (where there is
 * a local backend), and in development only when forced from the Enso devtools.
 *
 * It checks the latest release of this fork, not of upstream `enso-org/enso` (`RELEASES_REPOSITORY`
 * in `$/utils/github`, #180).
 */
import { useBackends } from '$/providers/backends'
import { useDevtoolsStore } from '$/providers/devTools'
import { IS_DEV_MODE } from 'enso-common/src/utilities/detect'
import { computed } from 'vue'

/** Whether the version checker is enabled. */
export function useVersionCheckerEnabled() {
  const backends = useBackends()
  const devtools = useDevtoolsStore()
  return computed(() =>
    IS_DEV_MODE ? (devtools.showVersionChecker ?? false) : backends.localBackend != null,
  )
}

/**
 * The version number of a version string, or `null` if it is not one. (Only the first dot is
 * removed, so `2025.1.1` is `20251.1`, as it always has been.)
 */
export function getVersionNumber(version: string) {
  const versionNumber = Number(version.replace('.', ''))
  return isNaN(versionNumber) ? null : versionNumber
}

/**
 * Whether the release tagged `releaseTag` is an update of the build `currentVersion`: both are
 * version numbers, the release's is the greater, and the build is not a development or nightly one.
 */
export function isNewerRelease(releaseTag: string, currentVersion: string) {
  const releaseNumber = getVersionNumber(releaseTag)
  const currentNumber = getVersionNumber(currentVersion)
  return (
    releaseNumber != null &&
    currentNumber != null &&
    !currentVersion.endsWith('-dev') &&
    !currentVersion.includes('-nightly') &&
    releaseNumber > currentNumber
  )
}
