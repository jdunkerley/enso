/** @file A project's toast about libraries it could not load, with the offer to switch edition. */
import type { ProjectStore } from '$/providers/openedProjects/project'
import { useText } from '$/providers/text'
import UnresolvedLibrariesToast from '@/components/GraphEditor/UnresolvedLibrariesToast.vue'
import { useToast } from '@/util/toast'
import { getMessageOrToString } from 'enso-common/src/utilities/errors'
import { markRaw, onActivated, onDeactivated, watch } from 'vue'
import type { LibraryLoadFailure, response } from 'ydoc-shared/languageServerTypes'

/** What the edition switch needs besides the project store. */
export interface EditionSwitchDependencies {
  /** Save a version of the project, if its versions are kept; it must not reject when they are not. */
  saveVersion(comment: string): Promise<void>
}

/* Note [The Edition Switch]
 * ~~~~~~~~~~~~~~~~~~~~~~~~~~
 * A project whose libraries cannot be loaded (`library/loadFailed`, `library/listLoadFailures`) gets
 * one sticky toast naming them; so does a project whose edition is not installed and that runs on
 * the bundled edition meanwhile (`EditionNotFound`). `editions/checkSwitch` then says whether the
 * bundled edition would load them, plus `Standard.Base`, keeping the project's own library
 * overrides. Only then does the toast offer "Switch and reopen", which saves a version first (when
 * the project's versions are kept, so the switch is one Restore away from undone), writes the new
 * parent edition with `editions/setParentEdition`, and closes and reopens the project, since the
 * engine reads its edition only when it starts; the close saves its own version as usual. If the
 * bundled edition would not do, the toast lists what is still missing, and nothing is written.
 *
 * The toast follows Note [The Start-up Toast Belongs To Its Project] in `toasts.ts`: shown only
 * while the project's tab is active, shown again when the tab is unless the user closed it (until
 * the failures change), and dismissed with the view.
 */
/**
 * Show the project's toast about libraries it could not load, or the edition that is not
 * installed, and switch the edition when asked. See Note [The Edition Switch].
 */
export function useUnresolvedLibrariesToast(
  project: Pick<ProjectStore, 'libraryLoadFailures' | 'lsRpcConnection' | 'restart'>,
  deps: EditionSwitchDependencies,
) {
  const { getText } = useText()
  const errorToast = useToast.error({ autoClose: false })
  const warningToast = useToast.warning({ autoClose: false })
  const switchFailedToast = useToast.error()

  let failures: readonly LibraryLoadFailure[] = []
  let check: response.CheckEditionSwitch | undefined
  let busy = false
  let active = true
  /** The toast was shown for the current failures and the user closed it. */
  let closedByUser = false
  /** The toast on screen (or queued), if this composable showed one. */
  let shown: ReturnType<typeof useToast> | undefined
  let checkRequest = 0

  /** Whether the user closed the toast this composable showed. */
  const userClosed = () => shown != null && !shown.isPending()

  function hide() {
    shown?.dismiss()
    shown = undefined
  }

  function render() {
    if (failures.length === 0) return hide()
    if (!active || closedByUser) return
    if (userClosed()) {
      closedByUser = true
      shown = undefined
      return
    }
    // Only the edition entry: the project runs, on the bundled edition.
    const toast = failures.every((f) => f.library == null) ? warningToast : errorToast
    if (shown !== toast) hide()
    toast.show({
      component: markRaw(UnresolvedLibrariesToast),
      props: { failures, check, busy, onSwitch: switchEdition },
    })
    shown = toast
  }

  async function requestCheck() {
    const request = ++checkRequest
    const result = await project.lsRpcConnection.checkEditionSwitch()
    if (request !== checkRequest) return
    if (!result.ok) {
      console.warn('Could not check an edition switch:', result.error.message())
      check = { current: null, target: '', resolves: false, changes: [], stillMissing: [] }
    } else {
      check = result.value
    }
    render()
  }

  async function switchEdition() {
    if (busy || check?.resolves !== true) return
    const target = check.target
    busy = true
    render()
    try {
      await deps.saveVersion(getText('editionSwitchVersionComment', target))
      const written = await project.lsRpcConnection.setParentEdition(target)
      if (!written.ok) throw new Error(written.error.message())
      await project.restart()
    } catch (error) {
      console.error('Could not switch the edition:', error)
      switchFailedToast.show(getText('editionSwitchFailed', getMessageOrToString(error)))
      busy = false
      render()
    }
  }

  watch(
    () => project.libraryLoadFailures,
    (current) => {
      failures = current
      check = undefined
      closedByUser = false
      if (userClosed()) shown = undefined
      render()
      if (current.length > 0) void requestCheck()
    },
    { immediate: true },
  )

  onActivated(() => {
    active = true
    render()
  })
  onDeactivated(() => {
    active = false
    if (userClosed()) closedByUser = true
    hide()
  })
}
