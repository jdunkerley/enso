/**
 * @file Whether the "new version available" check runs (#83): in the desktop app (where there is
 * a local backend), and in development only when forced from the Enso devtools.
 *
 * It checks the latest release of the upstream `enso-org/enso` repository (`$/utils/github`),
 * exactly as the React `VersionChecker` did; whether this fork should check its own releases is
 * an open question for its maintainer.
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
