import type { ProjectStore } from '$/providers/openedProjects/project'
import { TypeInfo } from '$/providers/openedProjects/project/computedValueRegistry'
import type { SuggestionDb } from '$/providers/openedProjects/suggestionDatabase'
import * as jsonVisualization from '@/components/visualizations/JSONVisualization'
import * as scatterplotVisualization from '@/components/visualizations/ScatterplotVisualization.vue'
import * as tableVisualization from '@/components/visualizations/TableVisualization.vue'
import * as warningsVisualization from '@/components/visualizations/WarningsVisualization.vue'
import { createContextStore } from '@/providers'
import { compile } from '@/stores/visualization/compilerMessaging'
import { watchVisualizationFolder } from '@/stores/visualization/folderLoader'
import {
  fromVisualizationId,
  toVisualizationId,
  VisualizationMetadataDb,
  visualizationsForTypes,
  type VisualizationId,
  type VisualizationMetadata,
} from '@/stores/visualization/metadata'
import { canonicalVisualizationId } from '@/stores/visualization/movedVisualizations'
import type { VisualizationModule } from '@/stores/visualization/runtimeTypes'
import type { Opt } from '@/util/data/opt'
import { isUrlString } from '@/util/data/urlString'
import { isIconName } from '@/util/iconMetadata/iconName'
import { computed, onScopeDispose, reactive } from 'vue'
import type { LanguageServer } from 'ydoc-shared/languageServer'
import type {
  ContentRoot,
  Event as LSEvent,
  Uuid,
  VisualizationConfiguration,
} from 'ydoc-shared/languageServerTypes'
import type { ExternalId, VisualizationIdentifier } from 'ydoc-shared/yjsModel'

/** How long a request for a library's visualization waits for the library to provide it. */
export const LIBRARY_WAIT_MS = 10_000

/** A module containing the default visualization function. */
const DEFAULT_VISUALIZATION_MODULE = 'Standard.Visualization.Preprocessor'
/** A name of the default visualization function. */
const DEFAULT_VISUALIZATION_FUNCTION = 'default_preprocessor'
/** A list of arguments passed to the default visualization function. */
const DEFAULT_VISUALIZATION_ARGUMENTS: string[] = []

export const DEFAULT_VISUALIZATION_CONFIGURATION = {
  visualizationModule: DEFAULT_VISUALIZATION_MODULE,
  expression: DEFAULT_VISUALIZATION_FUNCTION,
  positionalArgumentsExpressions: DEFAULT_VISUALIZATION_ARGUMENTS,
} satisfies Partial<VisualizationConfiguration>

export const DEFAULT_VISUALIZATION_IDENTIFIER: VisualizationIdentifier = {
  module: { kind: 'Builtin' },
  name: 'JSON',
}

export type VisualizationDataSource =
  | {
      type: 'node'
      nodeId: ExternalId
    }
  | {
      type: 'expression'
      expression: string
      contextId: ExternalId
    }

const builtinVisualizations: VisualizationModule[] = [
  jsonVisualization,
  tableVisualization,
  scatterplotVisualization,
  warningsVisualization,
]

const builtinVisualizationsByName = Object.fromEntries(
  builtinVisualizations.map((viz) => [viz.name, viz]),
)

export const [provideVisualizationStore, useVisualizationStore] = createContextStore(
  'visualization',
  (proj: ProjectStore, suggestionDb?: SuggestionDb) => {
    const cache = reactive(new Map<VisualizationId, Promise<VisualizationModule>>())
    /**
     * The requests for a library's visualization that arrived before the library registered it;
     * each is settled when the visualization registers, or rejected after {@link LIBRARY_WAIT_MS}.
     */
    const libraryWaiters = new Map<
      VisualizationId,
      { resolve: (viz: Promise<VisualizationModule>) => void; timer: ReturnType<typeof setTimeout> }
    >()
    const metadata = new VisualizationMetadataDb()
    const projectRoot = proj.projectRootId

    for (const { name, inputType, dataType, icon } of builtinVisualizations) {
      metadata.set(toVisualizationId({ module: { kind: 'Builtin' }, name }), {
        name,
        inputType,
        dataType,
        icon,
      })
    }

    const scriptsNode = document.head.appendChild(document.createElement('div'))
    scriptsNode.classList.add('visualization-scripts')

    const loadedScripts = new Set<string>()
    function loadScripts(module: VisualizationModule) {
      const promises: Promise<void>[] = []
      if ('scripts' in module && module.scripts) {
        if (!Array.isArray(module.scripts)) {
          console.warn('Visualiation scripts should be an array:', module.scripts)
        }
        const scripts = Array.isArray(module.scripts) ? module.scripts : [module.scripts]
        for (const url of scripts) {
          if (typeof url !== 'string') {
            console.warn('Visualization script should be a string, skipping URL:', url)
          } else if (!loadedScripts.has(url)) {
            loadedScripts.add(url)
            const node = document.createElement('script')
            node.src = url
            // Some resources still set only "Access-Control-Allow-Origin" in the response.
            // We need to explicitly make a request CORS - see https://resourcepolicy.fyi
            node.crossOrigin = 'anonymous'
            promises.push(
              new Promise<void>((resolve, reject) => {
                node.addEventListener('load', () => {
                  resolve()
                  // Once scripts are loaded and run, there is no need to keep the tag.
                  node.remove()
                })
                node.addEventListener('error', () => {
                  reject()
                  node.remove()
                })
              }),
            )
            scriptsNode.appendChild(node)
          }
        }
      }
      return Promise.allSettled(promises)
    }

    /** Make a visualization known to the store, and release anything waiting for it. */
    function register(
      id: VisualizationIdentifier,
      viz: Promise<VisualizationModule>,
      meta: VisualizationMetadata | undefined,
    ) {
      const key = toVisualizationId(id)
      cache.set(key, viz)
      if (meta) metadata.set(key, meta)
      const waiter = libraryWaiters.get(key)
      if (waiter) {
        libraryWaiters.delete(key)
        clearTimeout(waiter.timer)
        waiter.resolve(viz)
      }
    }

    /** Forget a visualization, whose file was removed, renamed or no longer compiles. */
    function unregister(id: VisualizationIdentifier) {
      const key = toVisualizationId(id)
      cache.delete(key)
      metadata.delete(key)
    }

    const folderWatchers = new Map<Uuid, { unsubscribe(): void }>()
    let stopWatching: (() => void) | undefined
    let disposed = false
    onScopeDispose(() => {
      disposed = true
      stopWatching?.()
      for (const watcher of folderWatchers.values()) watcher.unsubscribe()
      folderWatchers.clear()
      for (const waiter of libraryWaiters.values()) clearTimeout(waiter.timer)
      libraryWaiters.clear()
    })

    /** Watch the `visualizations/` folder of a content root; once per root. */
    function watchFolder(
      ls: LanguageServer,
      rootId: Uuid,
      module: VisualizationIdentifier['module'],
      quietIfMissing: boolean,
    ) {
      if (disposed || folderWatchers.has(rootId)) return
      folderWatchers.set(
        rootId,
        watchVisualizationFolder({
          ls,
          rootId,
          module,
          compile: async (address) => {
            const viz = await compile(address, await proj.dataConnection)
            await loadScripts(viz)
            return viz
          },
          register,
          unregister,
          quietIfMissing,
        }),
      )
    }

    function watchLibrary(ls: LanguageServer, root: Extract<ContentRoot, { type: 'Library' }>) {
      const module = { kind: 'Library', name: `${root.namespace}.${root.name}` } as const
      watchFolder(ls, root.id, module, true)
    }

    Promise.all([proj.lsRpcConnection, projectRoot]).then(async ([ls, projectRoot]) => {
      // Libraries are watched as they are announced, so a library loaded later is not missed.
      const onRootAdded = ({ root }: LSEvent<'file/rootAdded'>) => {
        if (root.type === 'Library') watchLibrary(ls, root)
      }
      ls.on('file/rootAdded', onRootAdded)
      stopWatching = () => ls.off('file/rootAdded', onRootAdded)
      if (disposed) stopWatching()
      if (projectRoot) {
        watchFolder(ls, projectRoot, { kind: 'CurrentProject' }, false)
      } else {
        console.error('Could not load custom visualizations: Project directory not found.')
      }
      for (const root of await ls.contentRoots) {
        if (root.type === 'Library') watchLibrary(ls, root)
      }
    })

    function* byType(typeInfo: Opt<TypeInfo>): IterableIterator<VisualizationIdentifier> {
      const types =
        typeInfo == null ?
          []
        : [...(typeInfo?.visibleTypes ?? []), ...(typeInfo?.hiddenTypes ?? [])]
      const vizzes =
        types.length === 0 ?
          metadata.keys()
        : visualizationsForTypes(
            metadata,
            types.map((type) => type.key()),
            (target) => suggestionDb?.conversionSources.lookup(target),
          )
      for (const viz of vizzes) yield fromVisualizationId(viz)
    }

    function icon(type: VisualizationIdentifier) {
      const icon = metadata.get(toVisualizationId(canonicalVisualizationId(type)))?.icon
      return icon && (isIconName(icon) || isUrlString(icon)) ? icon : undefined
    }

    function get(requested: VisualizationIdentifier, ignoreCache = false) {
      const meta = canonicalVisualizationId(requested)
      const key = toVisualizationId(meta)
      if (!cache.get(key) || ignoreCache) {
        switch (meta.module.kind) {
          case 'Builtin': {
            cache.set(key, resolveBuiltinVisualization(meta.name))
            break
          }
          case 'CurrentProject': {
            // No special handling needed; updates are handled by the folder watcher above.
            break
          }
          case 'Library': {
            // A library's folder is watched like the project's, so the visualization is there once
            // the library has loaded and its files have been read. Until then, wait for it.
            if (!cache.get(key)) {
              cache.set(key, waitForLibraryVisualization(key, meta.module.name, meta.name))
            }
            break
          }
        }
      }
      return computed(() => cache.get(key))
    }

    function waitForLibraryVisualization(key: VisualizationId, library: string, name: string) {
      const waiting = new Promise<VisualizationModule>((resolve, reject) => {
        const timer = setTimeout(() => {
          libraryWaiters.delete(key)
          if (cache.get(key) === waiting) cache.delete(key)
          reject(new Error(`The library '${library}' has no visualization '${name}'.`))
        }, LIBRARY_WAIT_MS)
        libraryWaiters.set(key, { resolve, timer })
      })
      // The requester handles a rejection; this keeps a cached, unread one from being reported.
      waiting.catch(() => {})
      return waiting
    }

    async function resolveBuiltinVisualization(type: string) {
      const module = builtinVisualizationsByName[type]
      if (!module) throw new Error(`Unknown visualization type: ${type}`)
      await loadScripts(module)
      return module
    }

    return { byType, get, icon }
  },
)
