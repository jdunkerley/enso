import type { ProjectStore } from '$/providers/openedProjects/project'
import { ConditionVariable } from '$/utils/ConditionVariable'
import { proxyRefs } from '$/utils/reactivity'
import { assert } from '@/util/assert'
import { Ast } from '@/util/ast'
import { type AstId, MutableModule } from '@/util/ast/abstract'
import { reactiveModule } from '@/util/ast/reactive'
import { type Events, stringUnionToArray } from '@/util/data/observable'
import type { MethodPointer } from '@/util/methodPointer'
import { Err, Ok, type Result } from 'enso-common/src/utilities/data/result'
import { computed, effectScope, markRaw, reactive, ref, type Ref, watch } from 'vue'
import { WebsocketProvider } from 'y-websocket'
import { xxHash128 } from 'ydoc-shared/ast/ffi'
import { SourceDocument } from 'ydoc-shared/ast/sourceDocument'
import {
  defaultLocalOrigin,
  DistributedModule,
  localUserActionOrigins,
  type Origin,
} from 'ydoc-shared/yjsModel'
import * as Y from 'yjs'
import type { ProjectNameStore } from '../projectNames'
import type { SuggestionDbStore } from '../suggestionDatabase'
import {
  applySavedAsts,
  type CarryOverDecision,
  countTextChanges,
  decideCarryOver,
  type ModuleSnapshot,
  OwnTexts,
  recordOwnTexts,
  saveAsts,
} from './carryOver'
import {
  type AbstractImport,
  addImports,
  analyzeImports,
  type DetectedConflict,
  detectImportConflicts,
  filterOutRedundantImports,
  importsWithoutConflicts,
  missingImports,
  printRequiredImport,
  type RequiredImport,
} from './imports'
import { whenReadyOnce } from './openImportCheck'

/**
 * How long to wait for the module's first AST before giving up with "Failed to open project".
 *
 * The module's document arrives over its own `y-websocket` connection. On a slow machine that
 * connection sometimes receives nothing at all after it opens. `y-websocket` recovers by itself:
 * it reconnects once a socket has been silent for 30 s (`messageReconnectTimeout`, checked every
 * 3 s), and the new connection syncs. On the Windows CI runner the reconnect came 32.8-33.2 s
 * after the document was first requested, every time (#212). With a 30 s limit, the project
 * failed for good just before it could recover. 75 s leaves room for two reconnects. A normal
 * load takes 13-25 s on that runner.
 */
const AST_LOAD_TIMEOUT_MS = 75_000

/**
 * How many of the module's own texts since the last update from the server are remembered for a
 * session replacement ({@link ModuleSnapshot}). A text older than that is forgotten, and a new
 * session that loads it asks the user instead of restoring.
 */
const OWN_TEXTS_LIMIT = 500

/** The hash a {@link ModuleSnapshot}'s `ownTexts` are made with. */
export function hashModuleText(text: string): string {
  return xxHash128(text)
}

/**
 * Module Store
 *
 * This store keeps the module AST and provides methods for analyzing and modifying it from
 * "code" perspective. It does not manage graph's nodes and connections, although it exposes
 * API for node and widgets metadata, as it is defined at AST level.
 */
export type ModuleStore =
  Awaited<ReturnType<typeof createModuleStore>> extends Result<infer T> ? T : never

export interface EditOptions {
  skipTreeRepair?: boolean
  origin?: Origin
  logLevel?: 'none' | 'info' | 'warn' | 'error'
  logPreamble?: string
}

/** Constructor of {@link ModuleStore} */
export async function createModuleStore(
  proj: ProjectStore,
  projectNames: ProjectNameStore,
  suggestionDb: SuggestionDbStore,
) {
  const FILE_NAME = 'Main.enso'
  proj.setObservedFileName(FILE_NAME)

  const scope = effectScope()

  const moduleModel = ref<DistributedModule | null>()
  const module = ref<Ast.MutableModule | null>()
  let abortModuleLoading: AbortController | undefined

  async function updateModuleModelIfChanged() {
    const currentGuid = proj.projectModel.modules.get(FILE_NAME)?.guid
    if (currentGuid !== moduleModel.value?.doc.ydoc.guid) {
      abortModuleLoading?.abort()
      const abort = new AbortController()
      abortModuleLoading = abort
      const newModule = await proj.projectModel.openModule(FILE_NAME)
      if (abort.signal.aborted) {
        newModule?.dispose()
        return
      }
      moduleModel.value?.dispose()
      if (newModule != null) {
        for (const origin of localUserActionOrigins) newModule.undoManager.addTrackedOrigin(origin)
        moduleModel.value = markRaw(newModule)
      } else {
        moduleModel.value = null
      }
    }
  }
  proj.projectModel.modules.observe(updateModuleModelIfChanged)

  watch(moduleModel, (moduleModel, _, onCleanup) => {
    module.value = moduleModel != null ? reactiveModule(moduleModel.doc.ydoc, onCleanup) : null
  })
  const source = SourceDocument.Empty(reactive)
  const root = ref<Ast.BodyBlock>()
  const ast = module as Ref<Ast.Module | null>
  const observers: ((update: Ast.ModuleUpdate) => void)[] = []
  const astLoaded = new ConditionVariable()

  watch(module, (module, _, onCleanup) => {
    if (module == null) root.value = undefined
    else {
      const handle = module.observe((update) => {
        const rootAst = module.root()
        if (rootAst instanceof Ast.BodyBlock) {
          root.value = rootAst
          astLoaded.notifyAll()
          if (
            update.nodesAdded.size != 0 ||
            update.nodesDeleted.size != 0 ||
            update.nodesUpdated.size != 0 ||
            update.updateRoots.size != 0
          ) {
            source.applyUpdate(module, update)
          }
          for (const observer of observers) observer(update)
        } else {
          root.value = undefined
        }
      })
      // An update from the server is a transaction whose origin is the module doc's provider.
      const ydoc = moduleModel.value?.doc.ydoc
      const stopRecording =
        ydoc != null ?
          recordOwnTexts(
            ydoc,
            () => source.text,
            ownTexts,
            (origin) => origin instanceof WebsocketProvider,
          )
        : () => {}
      onCleanup(() => {
        stopRecording()
        module.unobserve(handle)
        source.clear()
      })
    }
  })

  /** The texts the module went through since the last update from the server (`OwnTexts`). */
  const ownTexts = new OwnTexts(OWN_TEXTS_LIMIT, hashModuleText)

  await astLoaded.wait(AST_LOAD_TIMEOUT_MS)
  if (root.value == null) {
    return Err("Module's AST loading timed out")
  }

  return scope.run(() => {
    const undoManagerStatus = reactive({
      canUndo: false,
      canRedo: false,
      update(m: Y.UndoManager) {
        this.canUndo = m.canUndo()
        this.canRedo = m.canRedo()
      },
    })
    watch(
      () => moduleModel.value?.undoManager,
      (m) => {
        if (m) {
          const update = () => undoManagerStatus.update(m)
          const events = stringUnionToArray<keyof Events<Y.UndoManager>>()(
            'stack-item-added',
            'stack-item-popped',
            'stack-cleared',
            'stack-item-updated',
          )
          events.forEach((event) => m.on(event, update))
        }
      },
      { immediate: true },
    )

    const undoManager = proxyRefs({
      undo() {
        moduleModel.value?.undoManager.undo()
      },
      redo() {
        moduleModel.value?.undoManager.redo()
      },
      undoStackBoundary() {
        moduleModel.value?.undoManager.stopCapturing()
      },
      canUndo: computed(() => undoManagerStatus.canUndo),
      canRedo: computed(() => undoManagerStatus.canRedo),
    })

    function stopCapturingUndo() {
      moduleModel.value?.undoManager.stopCapturing()
    }

    function observe(f: (update: Ast.ModuleUpdate) => void) {
      observers.push(f)
      return () => {
        const index = observers.indexOf(f)
        if (index !== -1) observers.splice(index, 1)
      }
    }

    function edit<R extends Result<any>>(f: (edit: MutableModule) => R, options?: EditOptions): R
    function edit<R extends Result<any>>(
      f: (edit: MutableModule) => Promise<R>,
      options?: EditOptions,
    ): Promise<R>
    function edit<R extends Result<any>>(
      f: (edit: MutableModule) => R | Promise<R>,
      options?: EditOptions,
    ): R | Promise<R>

    /**
     * Edit the AST module.
     *
     * Optimization options: These are safe to use for metadata-only edits; otherwise, they require extreme caution.
     * @param options.skipTreeRepair - If the edit is certain not to produce incorrect or non-canonical syntax, this may be set
     * to `true` for better performance.
     */
    function edit(
      f: (edit: MutableModule) => Promise<Result> | Result,
      options: EditOptions = {},
    ): Promise<Result> | Result {
      const mod = module.value
      if (!mod) {
        return Err('Cannot apply edit, because module is unloaded.')
      }
      const edit = mod.edit()
      const logLevel = options.logLevel ?? 'error'

      const treeRepair = (result: Result) => {
        if (result.ok) {
          const root = edit.root()
          assert(root instanceof Ast.BodyBlock)
          edit.transact(() => Ast.repair(root, edit))
        }
        return result
      }

      const applyEdit = (result: Result) => {
        if (result.ok) mod.applyEdit(edit, options.origin)
        else if (logLevel !== 'none')
          console[logLevel](result.error.message(options.logPreamble ?? 'Cannot commit AST edit.'))
        return result
      }

      const result = edit.transact(() => {
        const result = f(edit)
        if (options.skipTreeRepair === true) return result
        return result instanceof Promise ? result.then(treeRepair) : treeRepair(result)
      })
      return result instanceof Promise ? result.then(applyEdit) : applyEdit(result)
    }

    function batchEdits(f: () => void, origin: Origin = defaultLocalOrigin) {
      if (!module.value) {
        console.error('Skipping batching edits, because module is gone.')
        return f()
      }
      return module.value.transact(f, origin)
    }

    function hasMethod(name: string): boolean {
      const rootValue = root.value
      return rootValue != null && Ast.findModuleMethod(rootValue, name) != null
    }

    function getMethodAst(ptr: MethodPointer, edit?: Ast.Module): Result<Ast.FunctionDef> {
      if (!root.value) return Err('Module unavailable')
      const topLevel = edit ? edit.getVersion(root.value) : root.value
      if (!topLevel) return Err('Module unavailable')
      if (!proj.moduleProjectPath?.ok)
        return proj.moduleProjectPath ?? Err('Unknown module project path')
      if (!ptr.module.equals(proj.moduleProjectPath.value))
        return Err('Cannot read method from different module')
      if (!ptr.module.equals(ptr.definedOnType)) return Err('Method pointer is not a module method')
      const method = Ast.findModuleMethod(topLevel, ptr.name)
      if (!method) {
        const modulePath = projectNames.printProjectPath(proj.moduleProjectPath.value)
        return Err(`No method with name ${ptr.name} in ${modulePath}`)
      }
      return Ok(method.statement)
    }

    function mutableNodeMetadata(node: AstId | undefined, edit?: Ast.MutableModule) {
      const edit_ = edit ?? module.value
      return edit_?.tryGet(node)?.mutableNodeMetadata()
    }

    function setWidgetMetadata(widget: AstId, widgetKey: string, md: unknown) {
      const ast = module.value?.tryGet(widget)
      if (!ast) return
      ast.setWidgetMetadata(widgetKey, md)
    }

    /**
     * Try adding imports. Do not add those conflicting with existing imports - return
     * {@link DetectedConflict} in such case.
     */
    function addMissingImports(
      edit: MutableModule,
      newImports: RequiredImport[],
    ): DetectedConflict[] | undefined {
      if (!root.value) {
        console.error(`BUG: Cannot add required imports: No BodyBlock module root.`)
        return
      }
      const topLevel = edit.getVersion(root.value)
      const existingImports = [...analyzeImports(topLevel, projectNames)]

      const conflicts = []
      const nonConflictingImports = []
      for (const newImport of newImports) {
        const conflictInfo = detectImportConflicts(suggestionDb.entries, existingImports, newImport)
        if (conflictInfo?.detected) {
          conflicts.push(conflictInfo)
        } else {
          nonConflictingImports.push(newImport)
        }
      }
      addMissingImportsDisregardConflicts(edit, nonConflictingImports, existingImports)

      if (conflicts.length > 0) return conflicts
    }

    /* Adds imports, ignores any possible conflicts.
     * `existingImports` are optional and will be used instead of `readImports(topLevel)` if provided. */
    function addMissingImportsDisregardConflicts(
      edit: MutableModule,
      imports: RequiredImport[],
      existingImports?: AbstractImport[] | undefined,
    ) {
      if (!imports.length) return
      if (!root.value) {
        console.error(`BUG: Cannot add required imports: No BodyBlock module root.`)
        return
      }
      const topLevel = edit.getVersion(root.value)
      const existingImports_ = existingImports ?? [...analyzeImports(topLevel, projectNames)]

      const importsToAdd = filterOutRedundantImports(existingImports_, imports)
      if (!importsToAdd.length) return
      addImports(topLevel, importsToAdd, projectNames)
    }

    /**
     * Add, in `edit`, the imports that the type names used in `scope` (the whole module by
     * default) need, so they are one undoable step with the change that needed them.
     * @returns the imports added.
     */
    function addDetectedImports(edit: MutableModule, scope?: Ast.Ast): RequiredImport[] {
      if (!root.value) return []
      const topLevel = edit.getVersion(root.value)
      const existingImports = [...analyzeImports(topLevel, projectNames)]
      const found = missingImports(
        topLevel,
        suggestionDb.entries,
        existingImports,
        scope ?? topLevel,
        suggestionDb.libraryPublicTypes,
      )
      if (found.length === 0) return []
      const conflicts = addMissingImports(edit, found) ?? []
      return importsWithoutConflicts(found, conflicts)
    }

    function onBeforeEdit(f: (transaction: Y.Transaction) => void): { unregister: () => void } {
      const m = moduleModel.value
      if (m) {
        m.doc.ydoc.on('beforeTransaction', f)
        return { unregister: () => m.doc.ydoc.off('beforeTransaction', f) }
      } else {
        return { unregister: () => {} }
      }
    }

    /**
     * The module as it is now, to carry over a replacement of its ydoc server session (see
     * {@link ModuleSnapshot}).
     */
    function carryOverSnapshot(): ModuleSnapshot | undefined {
      const rootValue = root.value
      if (rootValue == null) return undefined
      return {
        path: FILE_NAME,
        text: source.text,
        ownTexts: ownTexts.snapshot(),
        asts: saveAsts(rootValue),
      }
    }

    /** What to do with a snapshot taken from the module's previous session (`decideCarryOver`). */
    function carryOverDecision(snapshot: ModuleSnapshot): CarryOverDecision {
      return decideCarryOver(snapshot, source.text, hashModuleText)
    }

    /**
     * Put a snapshot taken from the module's previous session back, as one undoable edit of its
     * own: the module's text becomes `text` (unless it is `undefined`), and the snapshot's node
     * metadata and ids are merged where they apply.
     * @returns the number of changes made: separate text changes, and nodes changed.
     */
    function applyCarryOver(
      snapshot: ModuleSnapshot,
      { text }: { text: string | undefined },
    ): number {
      const before = source.text
      let changes = 0
      // Its own undo step: not merged with an edit made just before, or just after.
      stopCapturingUndo()
      const result = edit(
        (editedModule) => {
          const editedRoot = editedModule.root()
          if (editedRoot == null) return Err('The module has no root.')
          if (text != null && text !== editedRoot.code()) editedModule.syncToCode(text)
          const newRoot = editedModule.root()
          if (newRoot == null) return Err('The module has no root.')
          const textMatches = newRoot.code() === snapshot.text
          changes = applySavedAsts(newRoot, snapshot.asts, textMatches)
          return Ok()
        },
        { logPreamble: 'Cannot restore the changes made before the connection was restarted.' },
      )
      stopCapturingUndo()
      if (!result.ok) return 0
      return changes + countTextChanges(before, source.text)
    }

    /** Make the module's text `text`, as one undoable edit of its own. */
    function replaceText(text: string): Result {
      stopCapturingUndo()
      const result = edit(
        (editedModule) => {
          editedModule.syncToCode(text)
          return Ok()
        },
        { logPreamble: 'Cannot undo the restored changes.' },
      )
      stopCapturingUndo()
      return result
    }

    /** The imports added when the module was opened, for the graph editor's notice. */
    const importsAddedOnOpen = ref<RequiredImport[]>([])
    whenReadyOnce(
      () => (suggestionDb.loaded && suggestionDb.publicTypesLoaded ? root.value : undefined),
      (openedRoot) => {
        const needed = missingImports(
          openedRoot,
          suggestionDb.entries,
          [...analyzeImports(openedRoot, projectNames)],
          openedRoot,
          suggestionDb.libraryPublicTypes,
        )
        if (needed.length === 0) return
        let added: RequiredImport[] = []
        // Not a user action: the undo manager does not track this origin, so Ctrl+Z after
        // opening does not take the imports away.
        edit(
          (edit) => {
            added = addDetectedImports(edit)
            return Ok()
          },
          { origin: 'local:autoImport' },
        )
        if (added.length > 0) {
          console.info('Added the imports this module needed:', added.map(printRequiredImport))
          importsAddedOnOpen.value = added
        }
      },
    )

    return Ok(
      proxyRefs({
        source,
        ast,
        root,
        observe,
        edit,
        batchEdits,
        onBeforeEdit,
        hasMethod,
        getMethodAst,
        mutableNodeMetadata,
        setWidgetMetadata,
        addMissingImports,
        addDetectedImports,
        importsAddedOnOpen,
        carryOverSnapshot,
        carryOverDecision,
        applyCarryOver,
        replaceText,
        undoManager,
        stopCapturingUndo,
      }),
    )
  })!
}
