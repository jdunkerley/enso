/**
 * @file The bundled samples in the drive (`<projects>/Samples`): which rows are samples, which
 * have an update (an edited sample whose bundle changed), and the updates: Update Sample (the
 * "Update available" pill and the context menu) and Update All (the toolbar, in `Samples`). The
 * shim does the work (`project-manager-shim/src/samples`); a host without it (the browser dev
 * server without a bundle) answers with an error, and the drive then treats no row as a sample.
 */
import type { ContextMenuEntry } from '#/components/contextMenuEntry'
import UpdateSamplesModal from '#/layouts/Drive/UpdateSamplesModal.vue'
import { useBackends } from '$/providers/backends'
import { useModals } from '$/providers/modals'
import { useOpenedProjects } from '$/providers/openedProjects'
import { useText } from '$/providers/text'
import { useToasts } from '$/providers/toasts'
import { SAMPLES_STATUS_QUERY_KEY, samplesStatusQueryOptions } from '$/utils/samplesQuery'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  AssetType,
  BackendType,
  extractTypeAndPath,
  IS_OPENING_OR_OPENED,
  type AnyAsset,
  type DirectoryId,
} from 'enso-common/src/services/Backend'
import type { SamplesStatus } from 'enso-common/src/services/ProjectManager/types'
import { computed, watch } from 'vue'
import { useToastAndLog } from './driveActions'

/** One bundled sample, as the shim reports it. */
export type SampleEntry = SamplesStatus['samples'][number]

/** A path with `/` separators and no trailing separator, to compare with another. */
function comparablePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '')
}

/** The path of a local asset, or `null` for an id that names none. */
function assetPath(asset: Pick<AnyAsset, 'id'>): string | null {
  try {
    return comparablePath(extractTypeAndPath(asset.id).path)
  } catch {
    return null
  }
}

/** The bundled samples' states, and what the drive needs from them. */
export function useSamples() {
  const backends = useBackends()
  const query = useQuery(computed(() => samplesStatusQueryOptions(backends.localBackend)))
  const status = computed(() => query.data.value ?? null)
  const byPath = computed(
    () =>
      new Map((status.value?.samples ?? []).map((sample) => [comparablePath(sample.path), sample])),
  )

  /** The bundled sample a project row is, if it is one. */
  const sampleOf = (asset: AnyAsset): SampleEntry | null => {
    if (asset.type !== AssetType.project) return null
    const path = assetPath(asset)
    return path == null ? null : (byPath.value.get(path) ?? null)
  }

  /** Whether the folder `id` is the `Samples` folder. */
  const isSamplesDirectoryId = (id: DirectoryId): boolean => {
    if (status.value == null || status.value.samples.length === 0) return false
    return assetPath({ id }) === comparablePath(status.value.directory)
  }

  /** The samples with an update. */
  const withUpdates = computed(() =>
    (status.value?.samples ?? []).filter((sample) => sample.state === 'updateAvailable'),
  )

  return { status, sampleOf, isSamplesDirectoryId, withUpdates }
}

/** The bundled sample a project row is, if it has an update (an edited sample whose bundle changed). */
export function useSampleWithUpdate(asset: () => AnyAsset) {
  const { sampleOf } = useSamples()
  return computed(() => {
    const sample = sampleOf(asset())
    return sample?.state === 'updateAvailable' ? sample : null
  })
}

/** Whether a project row is open or opening, which keeps a sample from being updated. */
export function isOpenOrOpening(asset: AnyAsset): boolean {
  return asset.type === AssetType.project && IS_OPENING_OR_OPENED[asset.projectState.type]
}

/** The paths of the projects this app has open or opening, with `/` separators. */
function useOpenProjectPaths() {
  const openedProjects = useOpenedProjects()
  return computed(() => {
    const paths = new Set<string>()
    for (const project of openedProjects.listProjects()) {
      if (project.state.status === 'not-opened' && project.nextTask == null) continue
      const path = assetPath(project.state.info)
      if (path != null) paths.add(path)
    }
    return paths
  })
}

/** Update Sample and Update All, unconfirmed. Each says what it did in toasts. */
export function useUpdateSamples() {
  const backends = useBackends()
  const queryClient = useQueryClient()
  const toasts = useToasts()
  const toastAndLog = useToastAndLog()
  const { getText } = useText()

  /** Refetch the samples' states and the listings, after an update (or a failed one). */
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: SAMPLES_STATUS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: [BackendType.local, 'listDirectory'] }),
    ])
  }

  /** Warn about kept copies that still have their sample's name, and versions not saved. */
  const warn = (result: {
    readonly unrenamed: readonly string[]
    readonly fellBack: readonly { readonly name: string; readonly error: string }[]
  }) => {
    for (const { name, error } of result.fellBack) {
      toasts.show(getText('updateSampleFellBack', name, error), { type: 'warning' })
    }
    for (const copy of result.unrenamed) {
      toasts.show(getText('updateSampleUnrenamed', copy), { type: 'warning' })
    }
  }

  /** Update the sample `name`, and say how its edits were kept. */
  const updateSample = async (name: string) => {
    const backend = backends.localBackend
    if (backend == null) return
    try {
      const result = await backend.updateSample(name)
      const kept = result.kept[0]
      toasts.show(
        kept != null ? getText('updateSampleKept', name, kept)
        : result.versioned.length > 0 ? getText('updateSampleVersioned', name)
        : getText('updateSampleDone', name),
        { type: 'success' },
      )
      warn(result)
    } catch (error) {
      toastAndLog('updateSampleError', error, name)
    } finally {
      await refresh()
    }
  }

  /** Update every sample with an update, and say how their edits were kept. */
  const updateAllSamples = async () => {
    const backend = backends.localBackend
    if (backend == null) return
    try {
      const result = await backend.updateAllSamples()
      // Where the edits went, in one toast with what was updated.
      const kept = [
        ...(result.versioned.length > 0 ?
          [getText('updateAllSamplesVersioned', result.versioned.join(', '))]
        : []),
        ...(result.kept.length > 0 ?
          [getText('updateAllSamplesKept', result.kept.join(', '))]
        : []),
      ]
      if (result.updated.length === 0 && result.failed.length === 0) {
        // Already up to date (another window's Update All, say).
        toasts.show(getText('updateAllSamplesNothing'), { type: 'info' })
      } else if (result.failed.length === 0) {
        const done = getText('updateAllSamplesDone', result.updated.join(', '))
        toasts.show([done, ...kept].join(' '), { type: 'success' })
      } else {
        // Not "Updated the samples": some, perhaps all, were not. Say what failed.
        const failures = result.failed.map(({ name, error }) => `${name} (${error})`).join('; ')
        toastAndLog(null, getText('updateAllSamplesFailed', failures))
        if (kept.length > 0) toasts.show(kept.join(' '), { type: 'info' })
      }
      warn(result)
    } catch (error) {
      toastAndLog('updateAllSamplesError', error)
    } finally {
      await refresh()
    }
  }

  return { updateSample, updateAllSamples }
}

/**
 * Update Sample and Update All, each after a confirmation that says how every sample's edits
 * will be kept. A sample with no edits of the user's is updated without one.
 */
export function useConfirmedSampleUpdates() {
  const modals = useModals()
  const queryClient = useQueryClient()
  const toasts = useToasts()
  const { getText } = useText()
  const { updateSample, updateAllSamples } = useUpdateSamples()

  /** The samples' states, asked for again now: the confirmation names the current routes. */
  const currentSamples = async (): Promise<readonly SampleEntry[]> => {
    await queryClient.refetchQueries({ queryKey: SAMPLES_STATUS_QUERY_KEY })
    return queryClient.getQueryData<SamplesStatus | null>(SAMPLES_STATUS_QUERY_KEY)?.samples ?? []
  }

  /** Update `sample`, asking first when it has edits to keep. */
  const confirmUpdateSample = async (sample: SampleEntry) => {
    const current = (await currentSamples()).find(({ name }) => name === sample.name) ?? sample
    if (current.route == null) {
      await updateSample(current.name)
      return
    }
    modals.open(UpdateSamplesModal, {
      samples: [current],
      onConfirm: () => updateSample(current.name),
    })
  }

  /** Update every sample with an update, after asking; say so when there is none. */
  const confirmUpdateAll = async () => {
    const samples = (await currentSamples()).filter(({ state }) => state === 'updateAvailable')
    if (samples.length === 0) {
      toasts.show(getText('updateAllSamplesNothing'), { type: 'info' })
      return
    }
    modals.open(UpdateSamplesModal, { samples, onConfirm: updateAllSamples })
  }

  return { confirmUpdateSample, confirmUpdateAll }
}

/**
 * The context menu's entry for `asset`: Update Sample on a bundled sample, disabled, with a
 * tooltip saying why, while it is open.
 */
export function useSampleMenuEntries(asset: () => AnyAsset, isRunningProject: () => boolean) {
  const { getText } = useText()
  const samples = useSamples()
  const { confirmUpdateSample } = useConfirmedSampleUpdates()
  return computed((): ContextMenuEntry[] => {
    const sample = samples.sampleOf(asset())
    if (sample == null) return []
    const isOpen = isRunningProject()
    return [
      {
        action: 'updateSample',
        isDisabled: isOpen,
        tooltip: isOpen ? getText('updateSampleOpenTooltip') : undefined,
        doAction: () => {
          void confirmUpdateSample(sample)
        },
      },
    ]
  })
}

/**
 * The toolbar's Update All button in the folder `directoryId`: shown only in `Samples`, disabled,
 * with a tooltip saying why, when no sample has an update or one that has is open.
 */
export function useUpdateAllButton(directoryId: () => DirectoryId) {
  const { getText } = useText()
  const samples = useSamples()
  const openPaths = useOpenProjectPaths()
  const { confirmUpdateAll } = useConfirmedSampleUpdates()
  const queryClient = useQueryClient()
  const isShown = computed(() => samples.isSamplesDirectoryId(directoryId()))
  // Entering `Samples` asks for the states again, so its pills and this button are current.
  watch(isShown, (shown, wasShown) => {
    if (shown && !wasShown) {
      void queryClient.invalidateQueries({ queryKey: SAMPLES_STATUS_QUERY_KEY })
    }
  })
  const disabledReason = computed(() => {
    const toUpdate = samples.withUpdates.value
    if (toUpdate.length === 0) return getText('updateAllSamplesNoneTooltip')
    const isOpen = toUpdate.some((sample) => openPaths.value.has(comparablePath(sample.path)))
    return isOpen ? getText('updateAllSamplesOpenTooltip') : null
  })
  return {
    isShown,
    isDisabled: computed(() => disabledReason.value != null),
    tooltip: computed(() => disabledReason.value ?? getText('updateAllSamplesTooltip')),
    run: () => confirmUpdateAll(),
  }
}
