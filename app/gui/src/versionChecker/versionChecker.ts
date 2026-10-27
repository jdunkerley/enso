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
import gt from 'semver/functions/gt'
import parse from 'semver/functions/parse'
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
 * The semantic version of a version string, or `null` if it is not one. (Comparing versions as
 * numbers, with only the first dot removed, put `2026.1.10` before `2026.1.9` and made every rc
 * version `NaN`, #358.)
 */
export function parseVersion(version: string) {
  return parse(version)
}

/**
 * Whether the release tagged `releaseTag` is an update of the build `currentVersion`: both are
 * versions, the release's is the greater by semantic-versioning precedence (so a release is newer
 * than its own rcs), and the build is a release or an rc (not a development, nightly or test one).
 */
export function isNewerRelease(releaseTag: string, currentVersion: string) {
  const release = parseVersion(releaseTag)
  const current = parseVersion(currentVersion)
  const isReleaseOrRc =
    current != null && (current.prerelease.length === 0 || current.prerelease[0] === 'rc')
  return release != null && current != null && isReleaseOrRc && gt(release, current)
}
