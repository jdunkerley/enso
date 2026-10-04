<script lang="ts">
/**
 * @file The drive's table of assets: the Vue port of React's `AssetsTable`, with the same markup,
 * test ids, keyboard handling, selection (click, Shift and the platform's range and toggle
 * modifiers, the rubber-band `SelectionBrush`), drag and drop (rows onto rows, rows out to the
 * category buttons, files from the system), context menus, column toggles and paging.
 *
 * It lists the shown directory (`useDriveView`) in pages as it is scrolled, or the search results
 * while the query has text, and gives the search bar its suggestions. React's behaviour is kept
 * where the specs or a user could see it: the keyboard model is a plain table's (the arrow keys
 * move the selection, Shift extends it, Enter opens; no `treegrid`), the root takes the focus when
 * nothing else has it while the drive is the focused panel, and the drag selection measures rows
 * against the root, which does not scroll.
 */
import { Column } from '#/pages/dashboard/components/column/columnUtils'
import LocalStorage from '$/utils/LocalStorage'
import * as z from 'zod'

declare module '$/utils/LocalStorage' {
  interface LocalStorageData {
    readonly enabledColumns: readonly Column[]
  }
}

LocalStorage.registerKey('enabledColumns', {
  schema: z.nativeEnum(Column).array().readonly(),
})

/** The height of each row in the table body. It MUST be the one Tailwind's `h-table-row` sets. */
const ROW_HEIGHT_PX = 36

/** How long the layout isolation waits before following a resize, as React's `IsolateLayout`. */
const ISOLATE_LAYOUT_DEBOUNCE_MS = 16

/** A selection being drawn by a drag. */
interface DragSelectionInfo {
  readonly initialIndex: number
  readonly start: number
  readonly end: number
}
</script>

<script setup lang="ts">
import AssetsTableCombinedContextMenu from '#/layouts/AssetsTableCombinedContextMenu.vue'
import { useAssetItems } from '#/layouts/Drive/assetItems'
import { useAutoScroll } from '#/layouts/Drive/autoScroll'
import { ASSET_ROWS, setDragImageToBlank, type AssetRowsDragPayload } from '#/layouts/Drive/drag'
import {
  useEditSecret,
  useListDirectoryRefetchInterval,
  usePaste,
  usePendingMutations,
  useUploadFiles,
} from '#/layouts/Drive/driveActions'
import { useDriveView } from '#/layouts/Drive/driveView'
import { STOP_PRESS_AND_POINTER_PROPAGATION } from '#/layouts/Drive/pressPropagation'
import { SUGGESTIONS_FOR_TYPE, useSuggestions, type Suggestion } from '#/layouts/Drive/suggestions'
import AssetRow from '#/pages/dashboard/components/AssetRow.vue'
import {
  COLUMN_CSS_CLASS,
  COLUMN_ICONS,
  DEFAULT_ENABLED_COLUMNS,
  getColumnList,
} from '#/pages/dashboard/components/column/columnUtils'
import ColumnHeading from '#/pages/dashboard/components/columnHeading/ColumnHeading.vue'
import DriveLabel from '#/pages/dashboard/components/DriveLabel.vue'
import Button from '$/components/Button/Button.vue'
import DragModal from '$/components/Drive/DragModal.vue'
import Scroller from '$/components/Scroller/Scroller.vue'
import SelectionBrush, { type OnDragParams } from '$/components/SelectionBrush/SelectionBrush.vue'
import StatelessSpinner from '$/components/Spinner/StatelessSpinner.vue'
import Text from '$/components/Text/Text.vue'
import UserWithPopover from '$/components/UserWithPopover/UserWithPopover.vue'
import { useAuth } from '$/providers/auth'
import { categoryKey, useCategories } from '$/providers/category'
import { useContainerData } from '$/providers/container'
import { useDashboardInputBindings } from '$/providers/dashboardInputBindings'
import { useDriveLocation } from '$/providers/drive'
import { useDriveStore, type SelectedAssetInfo } from '$/providers/driveStore'
import { useFeatureFlag } from '$/providers/featureFlags'
import { useModals } from '$/providers/modals'
import { useRightPanelData } from '$/providers/rightPanel'
import { useText } from '$/providers/text'
import { useToasts } from '$/providers/toasts'
import AssetQuery from '$/utils/AssetQuery'
import type { AssetsDataTransferPayload } from '$/utils/assetsDataTransfer'
import { backendMutationOptions, backendQueryOptions } from '$/utils/backendQuery'
import { withPresence } from '$/utils/data/set'
import {
  deleteAssetsMutationKey,
  moveAssetsMutationKey,
  restoreAssetsMutationKey,
  type DeleteAssetsVariables,
  type RestoreAssetsVariables,
  type TransferAssetsVariables,
} from '$/utils/driveMutations'
import { listDirectoryQueryOptions, searchDirectoryQueryOptions } from '$/utils/driveQueries'
import { isElementTextInput, isTextInputEvent } from '$/utils/event'
import { DEFAULT_HANDLER } from '$/utils/inputBindings'
import { ASSETS_MIME_TYPE } from '$/utils/mimeTypes'
import type { SortInfo } from '$/utils/sorting'
import { twMerge } from '$/utils/style/tailwindMerge'
import type { QueryFunctionContext } from '@tanstack/query-core'
import { useInfiniteQuery, useQuery } from '@tanstack/vue-query'
import { useDebounceFn, useEventListener, useResizeObserver } from '@vueuse/core'
import {
  AssetType,
  IS_OPENING_OR_OPENED,
  isAssetCredential,
  isUnauthorizedError,
  LabelName,
  type AnyAsset,
  type AssetSortExpression,
  type DirectoryId,
  type PaginationToken,
} from 'enso-common/src/services/Backend'
import {
  userGroupIdToDirectoryId,
  userIdToDirectoryId,
} from 'enso-common/src/services/RemoteBackend/ids'
import { fileExtension } from 'enso-common/src/utilities/file'
import invariant from 'tiny-invariant'
import {
  computed,
  h,
  onMounted,
  onScopeDispose,
  onUnmounted,
  onUpdated,
  ref,
  shallowRef,
  watch,
} from 'vue'

const { query } = defineProps<{ query: AssetQuery }>()

const { getText } = useText()
const auth = useAuth()
const categories = useCategories()
const container = useContainerData()
const rightPanel = useRightPanelData()
const driveStore = useDriveStore()
const driveView = useDriveView()
const drive = useDriveLocation()
const assetItems = useAssetItems()
const { setSuggestions } = useSuggestions()
const inputBindings = useDashboardInputBindings()
const modals = useModals()
const toasts = useToasts()
const localStorage = LocalStorage.getInstance()

const location = computed(() => driveView.location)
const backend = computed(() => location.value.backend)
const category = computed(() => location.value.category)
const currentDirectoryId = computed(() => location.value.currentDirectoryId)
const user = computed(() => {
  const value = auth.session?.user
  invariant(value != null, 'The drive is only shown to a signed-in user.')
  return value
})

const labelsQuery = useQuery(computed(() => backendQueryOptions(backend.value, 'listTags', [])))
const usersQuery = useQuery(computed(() => backendQueryOptions(backend.value, 'listUsers', [])))
const userGroupsQuery = useQuery(
  computed(() => backendQueryOptions(backend.value, 'listUserGroups', [])),
)
const labels = computed(() => labelsQuery.data.value ?? [])

// === Columns ===

const enabledColumns = shallowRef<ReadonlySet<Column>>(
  new Set(localStorage.get('enabledColumns') ?? DEFAULT_ENABLED_COLUMNS),
)
watch(enabledColumns, (columns) => localStorage.set('enabledColumns', [...columns]), {
  immediate: true,
})
const allowedColumns = computed(() =>
  getColumnList(user.value.plan, backend.value.type, category.value.type, query.query !== ''),
)
const columns = computed(() =>
  allowedColumns.value.filter((column) => enabledColumns.value.has(column)),
)
const hiddenColumns = computed(() =>
  allowedColumns.value.filter((column) => !enabledColumns.value.has(column)),
)

function hideColumn(column: Column) {
  enabledColumns.value = withPresence(enabledColumns.value, column, false)
}

function toggleColumn(column: Column) {
  const newColumns = new Set(enabledColumns.value)
  if (enabledColumns.value.has(column)) newColumns.delete(column)
  else newColumns.add(column)
  enabledColumns.value = newColumns
}

const sortInfo = shallowRef<SortInfo<AssetSortExpression> | null>(null)
function setSortInfo(value: SortInfo<AssetSortExpression> | null) {
  sortInfo.value = value
}

// === The listing ===

/** The directory to list: an `owner:` term in the query lists that user's or group's home. */
const queryDirectoryId = computed((): DirectoryId | null => {
  const raw = location.value.queryDirectoryId
  const ownerLower = query.owners[0]?.toLowerCase()
  if (ownerLower == null) return raw
  const userId = usersQuery.data.value?.find((otherUser) =>
    otherUser.name.toLowerCase().includes(ownerLower),
  )?.userId
  if (userId != null) return userIdToDirectoryId(userId)
  const userGroupId = userGroupsQuery.data.value?.find((userGroup) =>
    userGroup.groupName.toLowerCase().includes(ownerLower),
  )?.id
  if (userGroupId != null) return userGroupIdToDirectoryId(userGroupId)
  return raw
})
const listDirectoryRefetchInterval = useListDirectoryRefetchInterval()
const debouncedQueryDelayMs = useFeatureFlag('dataCatalogQueryDebounceDelay')
const pageSize = useFeatureFlag('listDirectoryPageSize')

/** The query, as of the last time it stayed unchanged for the debounce delay. */
const debouncedQuery = shallowRef(query)
let debounceHandle = 0
watch(
  () => query,
  (newQuery) => {
    clearTimeout(debounceHandle)
    debounceHandle = window.setTimeout(() => {
      debouncedQuery.value = newQuery
    }, debouncedQueryDelayMs.value)
  },
)
onScopeDispose(() => clearTimeout(debounceHandle))

const assetsPages = useInfiniteQuery(
  computed(() => {
    const debounced = debouncedQuery.value
    const directoryId = queryDirectoryId.value
    const currentCategory = category.value
    const labelNames = debounced.labels.length !== 0 ? debounced.labels.map(LabelName) : null
    const options =
      debounced.query === '' ?
        listDirectoryQueryOptions({
          infinite: true,
          backend: backend.value,
          parentId: directoryId,
          category: currentCategory,
          refetchInterval: listDirectoryRefetchInterval.value,
          labels: labelNames,
          sortExpression: sortInfo.value?.field ?? null,
          sortDirection: sortInfo.value?.direction ?? null,
        })
      : searchDirectoryQueryOptions({
          infinite: true,
          backend: backend.value,
          parentId: directoryId,
          // The `query` parameter is not supported.
          query: null,
          title:
            debounced.keywords[0] != null ?
              debounced.keywords.join(' ')
            : (debounced.names[0] ?? null),
          extension: debounced.extensions[0] ?? null,
          description: debounced.descriptions[0] ?? null,
          type: debounced.types[0] ?? null,
          labels: labelNames,
          sortExpression: sortInfo.value?.field ?? null,
          sortDirection: sortInfo.value?.direction ?? null,
        })
    const currentPageSize = pageSize.value
    return {
      ...options,
      queryFn: (context: QueryFunctionContext) =>
        options.queryFn(context, {
          from: context.pageParam as PaginationToken | null,
          pageSize: currentPageSize,
        }),
      initialPageParam: null as PaginationToken | null,
      getNextPageParam: (lastPage: { assets: readonly AnyAsset[]; paginationToken?: unknown }) =>
        lastPage.assets.length === currentPageSize && currentCategory.type !== 'recent' ?
          ((lastPage.paginationToken ?? null) as PaginationToken | null)
        : null,
      retry: (_count: number, error: Error) => {
        if (isUnauthorizedError(error)) return false
        if (directoryId === queryDirectoryId.value) drive.currentCategory = currentCategory
        return false
      },
    }
  }) as never,
)

const assets = computed((): readonly AnyAsset[] => {
  const data = assetsPages.data.value as { pages: { assets: readonly AnyAsset[] }[] } | undefined
  return data?.pages.flatMap((page) => page.assets) ?? []
})
const isFetching = computed(() => assetsPages.isFetching.value)

const scroller = ref<InstanceType<typeof Scroller>>()
const scrollerContent = computed(() => scroller.value?.content)

/**
 * Ask for the next page when the end of the table is in view, and there is one. (React asked
 * whether or not there was one: with no next page the query settles at once, unchanged, and React
 * asked again on the next render, round and round; nothing on screen changed.)
 */
function fetchNextPageIfAtEnd() {
  // Do not request the next page while refetching, or the data is not updated:
  // https://github.com/TanStack/query/discussions/6709#discussioncomment-8142957
  if (isFetching.value || !assetsPages.hasNextPage.value) return
  const scrollerEl = scrollerContent.value
  if (!scrollerEl) return
  const tableEl = scrollerEl.children[0]
  if (!tableEl) return
  if (scrollerEl.scrollTop + scrollerEl.clientHeight >= tableEl.scrollHeight) {
    void assetsPages.fetchNextPage()
  }
}
watch([isFetching, () => assetsPages.data.value], fetchNextPageIfAtEnd, { flush: 'post' })

watch([currentDirectoryId, assets], ([parentId, items]) => assetItems.setItems(parentId, items), {
  immediate: true,
})

watch(
  () => categoryKey(category.value),
  () => driveStore.setAssetToRename(null),
  { immediate: true },
)

// === The asset panel follows the selection ===

function selectedAssetContext() {
  const selectedIds = driveStore.selectedIds
  if (selectedIds.size === 1) {
    const [soleId] = selectedIds
    const asset =
      soleId == null ? null : assets.value.find((otherAsset) => otherAsset.id === soleId)
    return { item: asset ?? undefined, category: category.value }
  }
  return { category: category.value }
}

// The temporary solution React had, to update the asset panel when the listing changes.
watch(
  [assets, category],
  () => {
    rightPanel.setContext({ type: 'drive' }, selectedAssetContext())
  },
  { immediate: true },
)

onScopeDispose(
  driveStore.subscribe(({ selectedIds }, { selectedIds: oldSelectedIds }) => {
    if (selectedIds !== oldSelectedIds) {
      rightPanel.setContext({ type: 'drive' }, selectedAssetContext())
      if (selectedIds.size === 1) rightPanel.setTemporaryTab(undefined)
    }
  }),
)

onScopeDispose(
  driveStore.subscribe(({ selectedIds }) => {
    if (selectedIds.size !== 1) {
      rightPanel.setContext({ type: 'drive' }, { category: category.value })
      rightPanel.setTemporaryTab(undefined)
    }
  }),
)

// Whether the selection can be downloaded: only directories, projects, files and datalinks can.
onScopeDispose(
  driveStore.subscribe(({ selectedIds }) => {
    const canBeDownloaded = (type: AssetType | undefined) =>
      type === AssetType.directory ||
      type === AssetType.project ||
      type === AssetType.file ||
      type === AssetType.datalink
    const map = new Map(assets.value.map((item) => [item.id, item]))
    const newCanDownload =
      selectedIds.size !== 0 &&
      Array.from(selectedIds).every((id) => canBeDownloaded(map.get(id)?.type))
    if (driveStore.state.canDownload !== newCanDownload) driveStore.setCanDownload(newCanDownload)
  }),
)

// === Suggestions for the search bar ===

/** A suggestion adding and removing a value of a query key. */
function suggestion(
  key: string,
  render: () => ReturnType<Suggestion['render']>,
  queryKey: Parameters<AssetQuery['add']>[0],
  value: string,
): Suggestion {
  return {
    key,
    render,
    addToQuery: (oldQuery) => oldQuery.add(queryKey, [value]),
    deleteFromQuery: (oldQuery) => oldQuery.delete(queryKey, [value]),
  }
}

watch(
  [() => query, labels, assets, () => usersQuery.data.value, () => userGroupsQuery.data.value],
  () => {
    const allVisible = () =>
      assets.value.map((node) => suggestion(node.id, () => node.title, 'names', node.title))
    const terms = AssetQuery.terms(query.query)
    const term = terms.find((otherTerm) => otherTerm.values.length === 0) ?? terms[terms.length - 1]
    const termValues = term?.values ?? []
    const shouldOmitNames = terms.some((otherTerm) => otherTerm.tag === 'name')

    if (termValues.length !== 0) {
      setSuggestions(shouldOmitNames ? [] : allVisible())
      return
    }
    switch (term?.tag ?? null) {
      case null:
      case '':
      case 'name': {
        setSuggestions(allVisible())
        break
      }
      case 'type': {
        setSuggestions(SUGGESTIONS_FOR_TYPE)
        break
      }
      case 'ext':
      case 'extension': {
        const extensions = assets.value
          .filter((node) => node.type === AssetType.file)
          .map((node) => fileExtension(node.title))
        setSuggestions(
          Array.from(new Set(extensions), (extension) =>
            suggestion(
              extension,
              () => AssetQuery.termToString({ tag: 'extension', values: [extension] }),
              'extensions',
              extension,
            ),
          ),
        )
        break
      }
      case 'modified': {
        const modifieds = assets.value.map((node) => {
          const date = new Date(node.modifiedAt)
          return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
        })
        setSuggestions(
          Array.from(new Set(['today', ...modifieds]), (modified) =>
            suggestion(
              modified,
              () => AssetQuery.termToString({ tag: 'modified', values: [modified] }),
              'modifieds',
              modified,
            ),
          ),
        )
        break
      }
      case 'createdAt': {
        const creations = assets.value.map((node) => {
          const date = new Date(node.createdAt)
          return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
        })
        setSuggestions(
          Array.from(new Set(['today', ...creations]), (createdAt) =>
            suggestion(
              createdAt,
              () => AssetQuery.termToString({ tag: 'createdAt', values: [createdAt] }),
              'creations',
              createdAt,
            ),
          ),
        )
        break
      }
      case 'label': {
        setSuggestions(
          labels.value.map((label) =>
            suggestion(
              label.value,
              () =>
                h(
                  DriveLabel,
                  { active: true, color: label.color, onPress: () => {} },
                  () => label.value,
                ),
              'labels',
              label.value,
            ),
          ),
        )
        break
      }
      case 'owner': {
        setSuggestions([
          ...(usersQuery.data.value ?? []).map((otherUser) =>
            suggestion(
              otherUser.userId,
              () => h(UserWithPopover, { user: otherUser }),
              'owners',
              otherUser.name,
            ),
          ),
          ...(userGroupsQuery.data.value ?? []).map((userGroup) =>
            suggestion(
              userGroup.id,
              () => AssetQuery.termToString({ tag: 'owner', values: [userGroup.groupName] }),
              'owners',
              userGroup.groupName,
            ),
          ),
        ])
        break
      }
      default: {
        setSuggestions(shouldOmitNames ? [] : allVisible())
        break
      }
    }
  },
  { immediate: true },
)

// === Copy, cut and paste ===

const paste = usePaste()
const uploadFiles = useUploadFiles(backend, () => category.value.type, driveStore)

let detachCancelCut: (() => void) | undefined
onMounted(() => {
  detachCancelCut = inputBindings.attach(document.body, 'keydown', {
    cancelCut: () => {
      if (driveStore.pasteData == null) return false
      driveStore.setPasteData(null)
    },
  })
})
onUnmounted(() => detachCancelCut?.())

/** The selected assets, in the listing's order of selection. */
function selectedListedAssets() {
  return Array.from(driveStore.selectedIds)
    .map((id) => assets.value.find((asset) => asset.id === id))
    .filter((asset) => asset != null)
}

function doCopy() {
  driveStore.setPasteData({
    type: 'copy',
    data: {
      backendType: backend.value.type,
      category: category.value,
      assets: selectedListedAssets(),
    },
  })
}

function doCut() {
  driveStore.setPasteData({
    type: 'move',
    data: {
      backendType: backend.value.type,
      category: category.value,
      assets: selectedListedAssets(),
    },
  })
  driveStore.setSelectedAssets([])
}

function doPaste(newParentIdRaw: DirectoryId) {
  let newParentId = newParentIdRaw
  const { pasteData } = driveStore.state
  if (pasteData == null) return
  if (pasteData.data.assets.some((asset) => asset.id === newParentId)) {
    if (pasteData.data.assets[0] && pasteData.data.assets.length === 1) {
      // The folder is the only thing selected: paste into its parent, not into itself.
      newParentId = pasteData.data.assets[0].parentId
    } else {
      toasts.show('Cannot paste a folder into itself.', { type: 'error' })
      return
    }
  }
  void paste({
    fromCategory: pasteData.data.category,
    toCategory: category.value,
    newParentId,
    pasteData: pasteData.data,
    method: pasteData.type,
  })
  driveStore.setPasteData(null)
}

// === The rows' in-flight mutations ===

const deletingSingle = usePendingMutations(
  () => backendMutationOptions(backend.value, 'deleteAsset').mutationKey ?? [],
)
const deletingMultiple = usePendingMutations(() => deleteAssetsMutationKey(backend.value.type))
const restoringSingle = usePendingMutations(
  () => backendMutationOptions(backend.value, 'undoDeleteAsset').mutationKey ?? [],
)
const restoringMultiple = usePendingMutations(() => restoreAssetsMutationKey(backend.value.type))
const updatingSingle = usePendingMutations(
  () => backendMutationOptions(backend.value, 'updateAsset').mutationKey ?? [],
)
const movingMultiple = usePendingMutations(() => moveAssetsMutationKey(backend.value.type))

/** The first argument of each mutation: the asset a single-asset mutation acts on. */
function firstArguments(mutations: readonly { state: { variables: unknown } }[]) {
  return new Set(
    mutations.map((mutation) => (mutation.state.variables as readonly unknown[] | undefined)?.[0]),
  )
}

const deletingIds = computed(
  () =>
    new Set<unknown>([
      ...firstArguments(deletingSingle.value),
      ...deletingMultiple.value.flatMap(
        (mutation) => (mutation.state.variables as DeleteAssetsVariables | undefined)?.[0] ?? [],
      ),
    ]),
)
const restoringIds = computed(
  () =>
    new Set<unknown>([
      ...firstArguments(restoringSingle.value),
      ...restoringMultiple.value.flatMap(
        (mutation) => (mutation.state.variables as RestoreAssetsVariables | undefined)?.ids ?? [],
      ),
    ]),
)
const updatingIds = computed(
  () =>
    new Set<unknown>([
      ...firstArguments(updatingSingle.value),
      ...movingMultiple.value.flatMap(
        (mutation) => (mutation.state.variables as TransferAssetsVariables | undefined)?.[0] ?? [],
      ),
    ]),
)

// === Keyboard ===

const root = ref<HTMLElement>()
const keyboardSelectedIndex = ref<number | null>(null)
let mostRecentlySelectedIndex: number | null = null
let selectionStartIndex: number | null = null

function setMostRecentlySelectedIndex(index: number | null, isKeyboard = false) {
  mostRecentlySelectedIndex = index
  keyboardSelectedIndex.value = isKeyboard ? index : null
}

const editSecret = useEditSecret(backend)

/**
 * Add the asset to the selection, or remove it if it is in it, from the selection as it was when
 * the key was pressed. (Ctrl+Space toggles twice from that same selection, as React's handler did,
 * so it ends up removing a sole selected asset.)
 */
function toggleSelected(selectedAssets: readonly SelectedAssetInfo[], item: AnyAsset) {
  driveStore.setSelectedAssets(
    selectedAssets.some((asset) => asset.id === item.id) ?
      selectedAssets.filter((asset) => asset.id !== item.id)
    : [...selectedAssets, item],
  )
}

function onKeyDown(event: KeyboardEvent) {
  const isTextInputFocused = isElementTextInput(document.activeElement)
  const isEventTextInputEvent = isTextInputEvent(event) || event.key === 'Enter'
  if (isTextInputFocused && isEventTextInputEvent) return
  const { selectedAssets } = driveStore.state
  const prevIndex = mostRecentlySelectedIndex
  const item = prevIndex == null ? null : assets.value[prevIndex]
  if (selectedAssets.length === 1 && item != null) {
    switch (event.key) {
      case 'Enter':
      case ' ': {
        if (event.key === ' ' && event.ctrlKey) {
          toggleSelected(selectedAssets, item)
        } else {
          switch (item.type) {
            case AssetType.directory: {
              event.preventDefault()
              event.stopPropagation()
              drive.currentDirectory = item.id
              break
            }
            case AssetType.project: {
              event.preventDefault()
              event.stopPropagation()
              container.openProjectLocally(item, backend.value.type)
              break
            }
            case AssetType.datalink: {
              event.preventDefault()
              event.stopPropagation()
              rightPanel.setTemporaryTab('settings')
              break
            }
            case AssetType.secret: {
              if (isAssetCredential(item)) {
                toasts.show(getText('cannotEditCredentialError'), { type: 'warning' })
              } else {
                event.preventDefault()
                event.stopPropagation()
                editSecret(item)
              }
              break
            }
            case AssetType.file:
            default: {
              break
            }
          }
        }
        break
      }
    }
  }
  switch (event.key) {
    case ' ': {
      if (event.ctrlKey && item != null) toggleSelected(selectedAssets, item)
      break
    }
    case 'Escape': {
      driveStore.setSelectedAssets([])
      setMostRecentlySelectedIndex(null)
      selectionStartIndex = null
      break
    }
    case 'ArrowUp':
    case 'ArrowDown': {
      if (!event.shiftKey) selectionStartIndex = null
      const oldIndex = prevIndex ?? 0
      const index =
        event.key === 'ArrowUp' ?
          Math.max(0, oldIndex - 1)
        : Math.min(assets.value.length - 1, oldIndex + 1)
      setMostRecentlySelectedIndex(index, true)
      if (event.shiftKey) {
        event.preventDefault()
        event.stopPropagation()
        // On Windows, Ctrl+Shift+Arrow behaves the same as Shift+Arrow.
        if (selectionStartIndex == null) selectionStartIndex = prevIndex ?? 0
        const startIndex = Math.min(index, selectionStartIndex)
        const endIndex = Math.max(index, selectionStartIndex) + 1
        driveStore.setSelectedAssets(assets.value.slice(startIndex, endIndex))
      } else if (event.ctrlKey) {
        event.preventDefault()
        event.stopPropagation()
        selectionStartIndex = null
      } else if (index !== prevIndex) {
        event.preventDefault()
        event.stopPropagation()
        const newItem = assets.value[index]
        if (newItem != null) driveStore.setSelectedAssets([newItem])
        selectionStartIndex = null
      } else {
        // The arrow key leaves this container: let it propagate, for `navigator2D` to move to
        // another container.
        driveStore.setSelectedAssets([])
        selectionStartIndex = null
      }
      break
    }
  }
}

useEventListener(
  document,
  'click',
  () => {
    keyboardSelectedIndex.value = null
  },
  { capture: true },
)

function onRootFocusOut(event: FocusEvent) {
  if (
    event.relatedTarget instanceof HTMLElement &&
    event.currentTarget instanceof HTMLElement &&
    !event.currentTarget.contains(event.relatedTarget)
  ) {
    keyboardSelectedIndex.value = null
  }
}

/** As React's ref callback did on every render: take the focus when nothing has it. */
function focusRootIfIdle() {
  if (document.activeElement === document.body && container.focusedPanel.type === 'drive') {
    root.value?.focus()
  }
}
onMounted(focusRootIfIdle)
onUpdated(focusRootIfIdle)

// === Selection ===

/** The new selection after a press on `otherAssets` (or a range), by the modifiers held. */
function calculateNewSelection(
  event: MouseEvent,
  otherAssets: readonly SelectedAssetInfo[],
  getRange: () => readonly SelectedAssetInfo[],
) {
  event.stopPropagation()
  let result: readonly SelectedAssetInfo[] = []
  inputBindings.handler({
    selectRange: () => {
      result = getRange()
    },
    selectAdditionalRange: () => {
      const { selectedAssets } = driveStore.state
      const newAssetsMap = new Map(
        [...selectedAssets, ...getRange()].map((asset) => [asset.id, asset]),
      )
      result = [...newAssetsMap.values()]
    },
    selectAdditional: () => {
      const { selectedIds, selectedAssets } = driveStore.state
      let count = 0
      for (const asset of otherAssets) {
        if (selectedIds.has(asset.id)) count += 1
      }
      const add = count * 2 < otherAssets.length
      if (add) {
        const newAssetsMap = new Map(
          [...selectedAssets, ...otherAssets].map((asset) => [asset.id, asset]),
        )
        result = [...newAssetsMap.values()]
      } else {
        const newIds = new Set(otherAssets.map((asset) => asset.id))
        result = selectedAssets.filter((asset) => !newIds.has(asset.id))
      }
    },
    [DEFAULT_HANDLER]: () => {
      result = otherAssets
    },
  })(event, false)
  return result
}

const { startAutoScroll, endAutoScroll, onMouseEvent } = useAutoScroll(root)

let dragSelectionRange: DragSelectionInfo | null = null

function preventSelection(event: PointerEvent) {
  const { target } = event
  if (target instanceof HTMLElement) {
    const row = target.closest('tr')
    return Boolean(row?.dataset.selected === 'true')
  }
  return false
}

function onSelectionDrag({ event, rectangle }: OnDragParams) {
  startAutoScroll()
  onMouseEvent(event)
  if (mostRecentlySelectedIndex != null) keyboardSelectedIndex.value = null
  const scrollContainer = root.value
  if (scrollContainer == null) return
  const rect = scrollContainer.getBoundingClientRect()
  const overlapsHorizontally = rect.right > rectangle.left && rect.left < rectangle.right
  const selectionTop = Math.max(0, rectangle.top - rect.top - ROW_HEIGHT_PX)
  const selectionBottom = Math.max(
    0,
    Math.min(rect.height, rectangle.bottom - rect.top - ROW_HEIGHT_PX),
  )
  const range = dragSelectionRange
  if (!overlapsHorizontally) {
    dragSelectionRange = null
  } else if (range == null) {
    const topIndex = (selectionTop + scrollContainer.scrollTop) / ROW_HEIGHT_PX
    const bottomIndex = (selectionBottom + scrollContainer.scrollTop) / ROW_HEIGHT_PX
    dragSelectionRange = {
      initialIndex: rectangle.signedHeight < 0 ? bottomIndex : topIndex,
      start: Math.floor(topIndex),
      end: Math.ceil(bottomIndex),
    }
  } else {
    const topIndex = (selectionTop + scrollContainer.scrollTop) / ROW_HEIGHT_PX
    const bottomIndex = (selectionBottom + scrollContainer.scrollTop) / ROW_HEIGHT_PX
    const endIndex = rectangle.signedHeight < 0 ? topIndex : bottomIndex
    dragSelectionRange = {
      initialIndex: range.initialIndex,
      start: Math.floor(Math.min(range.initialIndex, endIndex)),
      end: Math.ceil(Math.max(range.initialIndex, endIndex)),
    }
  }
  if (range == null) {
    driveStore.setVisuallySelectedKeys(null)
  } else {
    const otherAssets = assets.value.slice(range.start, range.end)
    driveStore.setVisuallySelectedKeys(
      new Set(calculateNewSelection(event, otherAssets, () => []).map((asset) => asset.id)),
    )
  }
}

function onSelectionDragEnd(event: PointerEvent) {
  event.stopImmediatePropagation()
  endAutoScroll()
  onMouseEvent(event)
  const range = dragSelectionRange
  if (range != null) {
    const otherAssets = assets.value.slice(range.start, range.end)
    driveStore.setSelectedAssets(calculateNewSelection(event, otherAssets, () => []))
  }
  driveStore.setVisuallySelectedKeys(null)
  dragSelectionRange = null
}

function onSelectionDragCancel() {
  driveStore.setVisuallySelectedKeys(null)
  dragSelectionRange = null
}

function grabRowKeyboardFocus(item: AnyAsset) {
  driveStore.setSelectedAssets([item])
}

function onRowClick(asset: AnyAsset, event: MouseEvent) {
  event.stopPropagation()
  const newIndex = assets.value.findIndex((otherAsset) => otherAsset.id === asset.id)
  const getRange = () => {
    if (mostRecentlySelectedIndex == null) return [asset]
    const startIndex = Math.min(mostRecentlySelectedIndex, newIndex)
    const endIndex = Math.max(mostRecentlySelectedIndex, newIndex) + 1
    return assets.value.slice(startIndex, endIndex)
  }
  driveStore.setSelectedAssets(calculateNewSelection(event, [asset], getRange))
  setMostRecentlySelectedIndex(newIndex)
  if (!event.shiftKey) selectionStartIndex = null
}

function selectRow(asset: AnyAsset) {
  setMostRecentlySelectedIndex(assets.value.findIndex((otherAsset) => otherAsset.id === asset.id))
  selectionStartIndex = null
  driveStore.setSelectedAssets([asset])
}

// === Drag and drop ===

function onRowDragStart(event: DragEvent, asset: AnyAsset) {
  startAutoScroll()
  onMouseEvent(event)
  let newSelectedKeys = driveStore.selectedIds
  if (!newSelectedKeys.has(asset.id)) {
    setMostRecentlySelectedIndex(assets.value.findIndex((otherAsset) => otherAsset.id === asset.id))
    selectionStartIndex = null
    newSelectedKeys = new Set([asset.id])
    driveStore.setSelectedAssets([asset])
  }
  const nodes = assets.value.filter((node) => newSelectedKeys.has(node.id))
  const isPayloadInvalid = nodes.some(
    (node) => node.type === AssetType.project && IS_OPENING_OR_OPENED[node.projectState.type],
  )
  if (isPayloadInvalid) {
    event.preventDefault()
    return
  }
  const payload: AssetRowsDragPayload = {
    category: category.value,
    items: nodes.map((node) => ({ key: node.id, asset: node })),
  }
  event.dataTransfer?.setData(
    ASSETS_MIME_TYPE,
    JSON.stringify({
      category: categoryKey(category.value),
      items: nodes.map((node) => ({
        id: node.id,
        title: node.title,
        type: node.type,
        parentId: node.parentId,
        parentsPath: node.parentsPath,
        virtualParentsPath: node.virtualParentsPath,
      })),
    } satisfies AssetsDataTransferPayload),
  )
  setDragImageToBlank(event)
  ASSET_ROWS.bind(event, payload)
  modals.closeAll()
  modals.open(DragModal, {
    assets: nodes,
    pageX: event.pageX,
    pageY: event.pageY,
    onDragEnd: () => {
      ASSET_ROWS.unbind(payload)
    },
  })
}

function onRowDrop(event: DragEvent, item: AnyAsset | null = null) {
  if (category.value.type === 'trash' || category.value.type === 'recent') return
  endAutoScroll()
  const directoryId = item?.type === AssetType.directory ? item.id : currentDirectoryId.value
  const payload = ASSET_ROWS.lookup(event)
  const items = payload?.items ?? []

  if (payload != null && items.every((innerItem) => innerItem.key !== directoryId)) {
    event.preventDefault()
    event.stopPropagation()
    modals.closeAll()
    void paste({
      fromCategory: payload.category,
      toCategory: category.value,
      newParentId: directoryId,
      pasteData: {
        backendType: backend.value.type,
        assets: items
          .filter(({ asset }) => asset.parentId !== directoryId)
          .map(({ asset }) => asset),
        category: category.value,
      },
      method: 'move',
    })
    return
  }
  if (event.dataTransfer?.types.includes('Files') === true) {
    event.preventDefault()
    event.stopPropagation()
    void uploadFiles(Array.from(event.dataTransfer.files), directoryId)
  }
}

function onDropzoneDragOver(event: DragEvent) {
  const payload = ASSET_ROWS.lookup(event)
  // Handle the drag even if the drop target is invalid, otherwise the drag preview stays.
  if (payload || event.dataTransfer?.types.includes('Files') === true) event.preventDefault()
}

function onDropzoneDrop(event: DragEvent) {
  event.preventDefault()
  event.stopPropagation()
  onRowDrop(event, null)
}

/** Clear the selection, as React's `AssetsTableAssetsUnselector` did on a press. */
function unselectOnPointerDown() {
  if (driveStore.selectedIds.size > 0) driveStore.setSelectedAssets([])
}

const fileInput = ref<HTMLInputElement>()
function onFilesChosen(event: Event) {
  const files = (event.target as HTMLInputElement).files
  void uploadFiles(Array.from(files ?? []), currentDirectoryId.value)
  // Choosing the same file again must fire `change` again.
  if (fileInput.value != null) fileInput.value.value = ''
}

// === Context menu ===

const contextMenu = ref<InstanceType<typeof AssetsTableCombinedContextMenu>>()

function openContextMenu(position: Pick<MouseEvent, 'pageX' | 'pageY'>) {
  contextMenu.value?.open(position)
}

function onContextMenu(event: MouseEvent) {
  if (event.target instanceof HTMLElement && event.target.dataset.testid === 'underlay') return
  event.preventDefault()
  event.stopPropagation()
  openContextMenu(event)
}

// === Layout isolation ===

/**
 * React's `IsolateLayout`: the content sits in an SVG `foreignObject` sized to the container, so
 * that its layout is computed apart from the rest of the page. The size follows the container's,
 * debounced as React did.
 */
const isolateContainer = ref<HTMLElement>()
const isolateSize = ref<{ width: number; height: number } | null>(null)
const updateIsolateSize = useDebounceFn(
  (width: number, height: number) => {
    isolateSize.value = { width, height }
  },
  ISOLATE_LAYOUT_DEBOUNCE_MS,
  { maxWait: ISOLATE_LAYOUT_DEBOUNCE_MS },
)
useResizeObserver(isolateContainer, (entries) => {
  const entry = entries[0]
  if (entry == null) return
  void updateIsolateSize(entry.contentRect.width, entry.contentRect.height)
})
const isolateStyle = computed(() =>
  isolateSize.value == null ?
    undefined
  : { width: `${isolateSize.value.width}px`, height: `${isolateSize.value.height}px` },
)

const specialEmptyText = computed(() =>
  query.query !== '' ? getText('noFilesMatchTheCurrentFilters')
  : currentDirectoryId.value !== categories.categoryDirectoryId(category.value) ?
    getText('thisFolderIsEmpty')
  : null,
)

const emptyText = computed(() =>
  category.value.type === 'trash' ? (specialEmptyText.value ?? getText('yourTrashIsEmpty'))
  : category.value.type === 'recent' ?
    (specialEmptyText.value ?? getText('youHaveNoRecentProjects'))
  : (specialEmptyText.value ?? getText('youHaveNoFiles')),
)

const isLoadingRow = computed(
  () => assetsPages.isLoading.value || assetsPages.isFetchingNextPage.value,
)
</script>

<template>
  <div class="relative grow contain-strict">
    <AssetsTableCombinedContextMenu
      ref="contextMenu"
      :currentDirectoryId="currentDirectoryId"
      :bindingTarget="root"
      :doCopy="doCopy"
      :doCut="doCut"
      :doPaste="doPaste"
    />
    <div
      v-if="hiddenColumns.length !== 0"
      data-testid="extra-columns"
      class="absolute right-3 top-0.5 z-1 flex self-end bg-dashboard p-2"
    >
      <div class="inline-flex gap-icons" @focusin="keyboardSelectedIndex = null">
        <Button
          v-for="column in hiddenColumns"
          :key="column"
          size="medium"
          variant="icon"
          :icon="COLUMN_ICONS[column]"
          :aria-label="getText(`${column}ColumnName`)"
          class="opacity-50"
          @press="toggleColumn(column)"
        />
      </div>
    </div>
    <div ref="isolateContainer" class="isolate h-full w-full contain-strict">
      <svg :style="isolateStyle" width="100%" height="100%">
        <foreignObject :style="isolateStyle" @keydown="onKeyDown">
          <div
            ref="root"
            tabindex="-1"
            class="h-full w-full flex-1 container-size"
            @focusout="onRootFocusOut"
          >
            <div class="flex h-full w-full min-w-full flex-col" @contextmenu="onContextMenu">
              <div
                class="flex h-full w-min min-w-full grow flex-col px-1"
                @drop="onRowDrop($event, null)"
              >
                <Scroller
                  ref="scroller"
                  scrollbar
                  fullSize
                  orientation="vertical"
                  class="h-full flex-1"
                  shadowStartClass="top-8"
                  @scroll.capture="fetchNextPageIfAtEnd"
                >
                  <!-- `max-w-[calc(100cqw_-_0.5rem)]` keeps it from shifting while scrolled
                  horizontally. -->
                  <table
                    class="isolate max-w-[calc(100cqw_-_0.5rem)] table-fixed border-collapse rounded-rows"
                  >
                    <thead
                      class="sticky top-0 isolate z-1 bg-dashboard before:absolute before:-inset-1 before:bottom-0 before:bg-dashboard"
                    >
                      <tr class="rounded-none text-sm font-semibold">
                        <th
                          v-for="column in columns"
                          :key="column"
                          :class="COLUMN_CSS_CLASS[column]"
                        >
                          <ColumnHeading
                            :column="column"
                            :sortInfo="sortInfo"
                            :hideColumn="hideColumn"
                            :setSortInfo="setSortInfo"
                          />
                        </th>
                      </tr>
                    </thead>
                    <tbody class="isolate">
                      <AssetRow
                        v-for="(item, index) in assets"
                        :key="item.id + item.virtualParentsPath"
                        :item="item"
                        :columns="columns"
                        :labels="labels"
                        :isKeyboardSelected="keyboardSelectedIndex === index"
                        :isDeleting="deletingIds.has(item.id)"
                        :isRestoring="restoringIds.has(item.id)"
                        :isUpdating="updatingIds.has(item.id)"
                        :grabKeyboardFocus="grabRowKeyboardFocus"
                        :onRowClick="onRowClick"
                        :select="selectRow"
                        :onRowDragStart="onRowDragStart"
                        :onRowDragEnd="endAutoScroll"
                        :onRowDrop="onRowDrop"
                        :openContextMenu="openContextMenu"
                      />
                      <tr class="hidden h-row first:table-row">
                        <td :colspan="columns.length" class="h-table-row bg-transparent">
                          <Text class="px-cell-x placeholder" disableLineHeightCompensation>
                            {{ emptyText }}
                          </Text>
                        </td>
                      </tr>
                      <tr v-if="isLoadingRow" class="h-row">
                        <td :colspan="columns.length" class="rounded-full bg-transparent">
                          <div class="flex justify-center">
                            <StatelessSpinner :size="32" phase="loading-medium" />
                          </div>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <!-- `max-w-[calc(100cqw_-_0.5rem)]` keeps it from shifting while scrolled
                  horizontally. -->
                  <div
                    data-testid="root-directory-dropzone"
                    :class="
                      twMerge(
                        'sticky left-1 grid max-w-[calc(100cqw_-_0.5rem)] grow place-items-center pb-40 pt-20',
                        (category.type === 'recent' || category.type === 'trash') && 'hidden',
                      )
                    "
                    @dragenter="onDropzoneDragOver"
                    @dragover="onDropzoneDragOver"
                    @drop="onDropzoneDrop"
                    @click="driveStore.setSelectedAssets([])"
                    @pointerdown="unselectOnPointerDown"
                  >
                    <Button
                      size="custom"
                      variant="custom"
                      class="rounded-2xl"
                      contentClass="h-[186px] flex flex-col items-center gap-3 text-primary/30 transition-colors duration-200 hover:text-primary/50"
                      v-bind="STOP_PRESS_AND_POINTER_PROPAGATION"
                      @press="fileInput?.click()"
                    >
                      <template #icon>
                        <svg
                          width="186"
                          height="186"
                          viewBox="0 0 186 186"
                          fill="none"
                          aria-hidden="true"
                        >
                          <path
                            d="M35.857 96.4941C35.2422 92.8346 38.0633 89.5 41.7741 89.5H144.226C147.937 89.5 150.758 92.8346 150.143 96.4941L141.995 144.994C141.51 147.884 139.008 150 136.078 150H49.9221C46.992 150 44.4905 147.884 44.005 144.994L35.857 96.4941Z"
                            fill="currentColor"
                            fill-opacity="0.3"
                            stroke="currentColor"
                            stroke-width="2"
                          />
                          <path
                            d="M53 35C53 33.8954 53.8954 33 55 33H120.086L133 45.9142V61V89.5H53V35Z"
                            stroke="currentColor"
                            stroke-width="2"
                          />
                          <path
                            d="M44 59C44 55.6863 46.6863 53 50 53H53V89.5H44V59Z"
                            fill="currentColor"
                            stroke="currentColor"
                            stroke-width="2"
                          />
                          <path
                            d="M142 67C142 63.6863 139.314 61 136 61H133V89H142V67Z"
                            fill="currentColor"
                            fill-opacity="0.8"
                            stroke="currentColor"
                            stroke-width="2"
                          />
                          <path
                            d="M93 111V127M85 119H101"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                          />
                          <path
                            d="M93 43.5V73.5M93 73.5L103.5 63.5M93 73.5L82.5 63.5"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                          />
                          <circle
                            cx="93"
                            cy="93"
                            r="92"
                            stroke="currentColor"
                            stroke-opacity="0.5"
                            stroke-width="2"
                            stroke-dasharray="4 4"
                          />
                        </svg>
                      </template>
                      {{ getText('assetsDropzoneDescription') }}
                    </Button>
                    <input
                      ref="fileInput"
                      type="file"
                      class="react-aria-Input"
                      style="display: none"
                      @change="onFilesChosen"
                    />
                  </div>
                  <!-- A stable area to click to deselect, used by tests. -->
                  <div
                    data-testid="assets-table-background"
                    class="h-8 w-full shrink-0"
                    @pointerdown="unselectOnPointerDown"
                  />
                </Scroller>
              </div>
            </div>
          </div>
        </foreignObject>
      </svg>
    </div>
    <SelectionBrush
      :target="root"
      :onDrag="onSelectionDrag"
      :onDragEnd="onSelectionDragEnd"
      :onDragCancel="onSelectionDragCancel"
      :preventDrag="preventSelection"
    />
  </div>
</template>
