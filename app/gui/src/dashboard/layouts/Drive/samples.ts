/**
 * @file The bundled samples in the drive (`<projects>/Samples`): which rows are samples, which
 * have an update (an edited sample whose bundle changed), and the two resets. The shim does the
 * work (`project-manager-shim/src/samples`); a host without it (the browser dev server without a
 * bundle) answers with an error, and the drive then treats no row as a sample.
 */
import type { ContextMenuEntry } from '#/components/contextMenuEntry'
import { useBackends } from '$/providers/backends'
import { useOpenedProjects } from '$/providers/openedProjects'
import { useText } from '$/providers/text'
import { useToasts } from '$/providers/toasts'
import { SAMPLES_STATUS_QUERY_KEY, samplesStatusQueryOptions } from '$/utils/samplesQuery'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  AssetType,
  BackendType,
  extractTypeAndPath,
  type AnyAsset,
} from 'enso-common/src/services/Backend'
import type { SamplesStatus } from 'enso-common/src/services/ProjectManager/types'
import { computed } from 'vue'
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

  /** Whether a row is the `Samples` folder. */
  const isSamplesDirectory = (asset: AnyAsset): boolean => {
    if (asset.type !== AssetType.directory || status.value == null) return false
    if (status.value.samples.length === 0) return false
    return assetPath(asset) === comparablePath(status.value.directory)
  }

  return { status, sampleOf, isSamplesDirectory }
}

/** Whether an asset row's project has an update: an edited sample whose bundle changed. */
export function useSampleUpdateAvailable(asset: () => AnyAsset) {
  const { sampleOf } = useSamples()
  return computed(() => sampleOf(asset())?.state === 'updateAvailable')
}

/** Whether a project opened by this app is one of the bundled samples (or under `Samples`). */
export function useOpenSamples() {
  const openedProjects = useOpenedProjects()
  const { status } = useSamples()
  return computed(() => {
    const directory = status.value && comparablePath(status.value.directory)
    if (directory == null) return false
    for (const project of openedProjects.listProjects()) {
      if (project.state.status === 'not-opened' && project.nextTask == null) continue
      const path = assetPath(project.state.info)
      if (path != null && path.startsWith(`${directory}/`)) return true
    }
    return false
  })
}

/** The two resets: one sample, and every sample with `Data/`. Each tells what it kept. */
export function useResetSamples() {
  const backends = useBackends()
  const queryClient = useQueryClient()
  const toasts = useToasts()
  const toastAndLog = useToastAndLog()
  const { getText } = useText()

  /** Refetch the samples' states and the listings, after a reset (or a failed one). */
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: SAMPLES_STATUS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: [BackendType.local, 'listDirectory'] }),
    ])
  }

  /** Reset the sample `name`, and say what was kept. */
  const resetSample = async (name: string) => {
    const backend = backends.localBackend
    if (backend == null) return
    try {
      const { kept } = await backend.resetSample(name)
      toasts.show(
        kept[0] != null ?
          getText('resetSampleKept', name, kept[0])
        : getText('resetSampleDone', name),
        { type: 'success' },
      )
    } catch (error) {
      toastAndLog('resetSampleError', error, name)
    } finally {
      await refresh()
    }
  }

  /** Reset every sample and `Data/` file, and say what was kept. */
  const resetAllSamples = async () => {
    const backend = backends.localBackend
    if (backend == null) return
    try {
      const { kept } = await backend.resetAllSamples()
      toasts.show(
        kept.length > 0 ?
          getText('resetAllSamplesKept', kept.join(', '))
        : getText('resetAllSamplesDone'),
        { type: 'success' },
      )
    } catch (error) {
      toastAndLog('resetAllSamplesError', error)
    } finally {
      await refresh()
    }
  }

  return { resetSample, resetAllSamples }
}

/**
 * The context menu's sample entries for `asset`: Reset Sample on a bundled sample, Reset All
 * Samples on the `Samples` folder. Each is disabled, with a tooltip saying why, while a sample it
 * would change is open.
 */
export function useSampleMenuEntries(asset: () => AnyAsset, isRunningProject: () => boolean) {
  const { getText } = useText()
  const samples = useSamples()
  const openSamples = useOpenSamples()
  const { resetSample, resetAllSamples } = useResetSamples()
  return computed((): ContextMenuEntry[] => {
    const entries: ContextMenuEntry[] = []
    const sample = samples.sampleOf(asset())
    if (sample != null) {
      const isOpen = isRunningProject()
      entries.push({
        action: 'resetSample',
        isDisabled: isOpen,
        tooltip: isOpen ? getText('resetSampleOpenTooltip') : undefined,
        doAction: () => {
          void resetSample(sample.name)
        },
      })
    }
    if (samples.isSamplesDirectory(asset())) {
      const isOpen = openSamples.value
      entries.push({
        action: 'resetAllSamples',
        isDisabled: isOpen,
        tooltip: isOpen ? getText('resetAllSamplesOpenTooltip') : undefined,
        doAction: () => {
          void resetAllSamples()
        },
      })
    }
    return entries
  })
}
