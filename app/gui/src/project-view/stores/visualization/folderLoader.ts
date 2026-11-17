import type { VisualizationMetadata } from '@/stores/visualization/metadata'
import { rootAddress } from '@/stores/visualization/rootAddress'
import {
  InvalidVisualizationModuleError,
  type VisualizationModule,
} from '@/stores/visualization/runtimeTypes'
import {
  ErrorCode,
  LsRpcError,
  RemoteRpcError,
  type LanguageServer,
} from 'ydoc-shared/languageServer'
import type { Event as LSEvent, Uuid } from 'ydoc-shared/languageServerTypes'
import type { VisualizationIdentifier } from 'ydoc-shared/yjsModel'

/** The directory, in a project or a library, under which visualizations can be found. */
export const visualizationsDirectory = 'visualizations'

export interface WatchVisualizationFolderOptions {
  ls: Pick<LanguageServer, 'watchFiles'> & Partial<Pick<LanguageServer, 'isDisposed'>>
  /** The content root whose `visualizations/` folder is watched. */
  rootId: Uuid
  /** The module the visualizations found are registered under. */
  module: VisualizationIdentifier['module']
  /** Compile the file at an address made by {@link rootAddress}. */
  compile: (address: string) => Promise<VisualizationModule>
  /**
   * Make a visualization known. Called when a compilation starts for an id that is already known
   * (with the pending module and no metadata, so that readers do not see the old module), and again
   * when it finishes (with the metadata).
   */
  register: (
    id: VisualizationIdentifier,
    viz: Promise<VisualizationModule>,
    meta: VisualizationMetadata | undefined,
  ) => void
  /** Forget a visualization: its file was removed, renamed or no longer compiles. */
  unregister: (id: VisualizationIdentifier) => void
  /**
   * Whether a missing `visualizations/` folder goes unremarked. A library need not have one; a
   * project that has none is told how to add one.
   */
  quietIfMissing: boolean
}

/**
 * The path of a file event inside the watched folder. The language server reports the files that
 * exist when a watch starts relative to the folder, but a later change relative to the content
 * root, so a leading `visualizations` is dropped (a folder of that name inside `visualizations/`
 * is read the same way, which is a loss only for such nested folders).
 */
function pathInFolder(segments: readonly string[]): readonly string[] {
  return segments[0] === visualizationsDirectory ? segments.slice(1) : segments
}

/**
 * Keep the visualizations in a content root's `visualizations/` folder compiled and registered: the
 * existing `.vue` files and every later addition, change and removal. A change made while an
 * earlier one is still compiling supersedes it.
 */
export function watchVisualizationFolder({
  ls,
  rootId,
  module,
  compile,
  register,
  unregister,
  quietIfMissing,
}: WatchVisualizationFolderOptions): { unsubscribe(): void } {
  /**
   * A map from file to {@link AbortController}, so that a newer event for a file stops the older.
   */
  const abortControllers = new Map<string, AbortController>()
  /** A map from file to visualization name, so that a removal can unregister the visualization. */
  const namesByFile = new Map<string, string>()

  function onFileEvent({ kind, path }: LSEvent<'file/event'>) {
    if (path.rootId !== rootId) return
    const segments = pathInFolder(path.segments)
    if (!/[.]vue$/.test(segments.at(-1) ?? '')) return
    const file = segments.join('/')
    const address = rootAddress(rootId, [visualizationsDirectory, ...segments])
    const name = namesByFile.get(file)
    const id: VisualizationIdentifier | undefined = name != null ? { module, name } : undefined
    abortControllers.get(file)?.abort()
    abortControllers.delete(file)
    switch (kind) {
      case 'Added':
      case 'Modified': {
        const abortController = new AbortController()
        abortControllers.set(file, abortController)
        const viz = compile(address)
        if (id) register(id, viz, undefined)
        void settle(file, id, viz, abortController)
        break
      }
      case 'Removed': {
        namesByFile.delete(file)
        if (id) unregister(id)
        break
      }
    }
  }

  async function settle(
    file: string,
    id: VisualizationIdentifier | undefined,
    viz: Promise<VisualizationModule>,
    abortController: AbortController,
  ) {
    try {
      const compiled = await viz
      if (abortController.signal.aborted) return
      namesByFile.set(file, compiled.name)
      if (id && id.name !== compiled.name) unregister(id)
      register({ module, name: compiled.name }, viz, {
        name: compiled.name,
        inputType: compiled.inputType,
        dataType: compiled.dataType,
        icon: compiled.icon,
      })
    } catch (error) {
      if (abortController.signal.aborted) return
      if (id) unregister(id)
      if (error instanceof InvalidVisualizationModuleError) {
        console.info(
          `Imported local file '${visualizationsDirectory}/${file}' ` +
            `which is not a visualization. ` +
            `If it is not a dependency, are you perhaps missing \`name\` or \`inputType\`?`,
        )
      } else {
        console.error('Could not load visualization:', error)
      }
    } finally {
      if (abortControllers.get(file) === abortController) abortControllers.delete(file)
    }
  }

  let stopped = false
  const watching = ls.watchFiles(rootId, [visualizationsDirectory], onFileEvent)
  void watching.promise.then((result) => {
    if (result.ok) return
    if (
      result.error.payload instanceof LsRpcError &&
      result.error.payload.cause instanceof RemoteRpcError &&
      result.error.payload.cause.code === ErrorCode.FILE_NOT_FOUND
    ) {
      if (!quietIfMissing) {
        console.info(
          "'visualizations/' folder not found in project directory. " +
            "If you have custom visualizations, please put them under 'visualizations/'.",
        )
      }
    } else if (!stopped && !ls.isDisposed) {
      result.error.log('Could not load custom visualizations')
    }
  })

  return {
    unsubscribe() {
      stopped = true
      watching.unsubscribe()
      for (const abortController of abortControllers.values()) abortController.abort()
      abortControllers.clear()
    },
  }
}
