<script setup lang="ts">
/**
 * @file The context menu of one asset: the Vue port of React's `AssetContextMenu`, with the same
 * entries, conditions and order. Its entries are also the asset table's shortcuts while one asset is
 * selected (`useMenuEntries`, scoped to the table), and the command palette's actions.
 */
import ContextMenu from '#/components/ContextMenu.vue'
import type { ContextMenuEntry } from '#/components/contextMenuEntry'
import { useAssetItems } from '#/layouts/Drive/assetItems'
import {
  useExportArchive,
  useMutationCallback,
  useNewProject,
  useUploadFileToCloud,
  useUploadFileToLocal,
} from '#/layouts/Drive/driveActions'
import { useDriveView } from '#/layouts/Drive/driveView'
import { useGlobalContextMenuEntries } from '#/layouts/Drive/globalContextMenuEntries'
import ManageLabelsModal from '$/cloud/labels/ManageLabelsModal.vue'
import { isUploadableAsset } from '$/cloud/uploadToCloud'
import { usePreferredTimeZone } from '$/cloud/versions/schedule'
import ConfirmDeleteModal from '$/components/AlertDialog/ConfirmDeleteModal.vue'
import { useCopy } from '$/components/Button/copy'
import { useIsFeatureUnderPaywall } from '$/composables/paywall'
import { useMenuEntries } from '$/composables/menuEntries'
import { useAuth } from '$/providers/auth'
import { useBackends } from '$/providers/backends'
import { isCloudCategory, useCategories } from '$/providers/category'
import { useContainerData, type Tab } from '$/providers/container'
import { useDriveStore } from '$/providers/driveStore'
import { useFeatureFlag } from '$/providers/featureFlags'
import { useModals } from '$/providers/modals'
import { useOpenedProjects } from '$/providers/openedProjects'
import { useRightPanelData } from '$/providers/rightPanel'
import { useText } from '$/providers/text'
import { backendMutationOptions } from '$/utils/backendQuery'
import {
  copyAssetsMutationOptions,
  deleteAssetsMutationOptions,
  downloadAssetsMutationOptions,
  restoreAssetsMutationOptions,
} from '$/utils/driveMutations'
import { now } from '@internationalized/date'
import * as backendModule from 'enso-common/src/services/Backend'
import {
  TEAMS_DIRECTORY_ID,
  USERS_DIRECTORY_ID,
} from 'enso-common/src/services/Backend/remoteBackendPaths'
import { IanaTimeZone, toRfc3339 } from 'enso-common/src/utilities/data/dateTime'
import * as permissions from 'enso-common/src/utilities/permissions'
import { computed } from 'vue'

const { asset, currentDirectoryId, bindingTarget, position, doCopy, doCut, doPaste } = defineProps<{
  asset: backendModule.AnyAsset
  currentDirectoryId: backendModule.DirectoryId
  position: Pick<MouseEvent, 'pageX' | 'pageY'>
  /** The element whose keys the entries' shortcuts act on: the assets table. */
  bindingTarget: HTMLElement | null | undefined
  doCopy: () => void
  doCut: () => void
  doPaste: (newParentId: backendModule.DirectoryId) => void
}>()

const open = defineModel<boolean>('open', { required: true })

const emit = defineEmits<{ close: [] }>()

const { getText } = useText()
const auth = useAuth()
const categories = useCategories()
const container = useContainerData()
const openedProjects = useOpenedProjects()
const rightPanel = useRightPanelData()
const driveStore = useDriveStore()
const driveView = useDriveView()
const assetItems = useAssetItems()
const modals = useModals()
const { localBackend } = useBackends()
const isFeatureUnderPaywall = useIsFeatureUnderPaywall()
const showDeveloperIds = useFeatureFlag('showDeveloperIds')
const preferredTimeZone = usePreferredTimeZone()

const category = computed(() => driveView.location.category)
const backend = computed(() => driveView.location.backend)
const isCloud = computed(() => isCloudCategory(category.value))
const user = computed(() => {
  const value = auth.session?.user
  if (value == null) throw new Error('The drive is only shown to a signed-in user.')
  return value
})

const deleteAssets = useMutationCallback(() => deleteAssetsMutationOptions(backend.value))
const restoreAssets = useMutationCallback(() => restoreAssetsMutationOptions(backend.value))
const copyAssets = useMutationCallback(() => copyAssetsMutationOptions(backend.value))
const downloadAssets = useMutationCallback(() => downloadAssetsMutationOptions(backend.value))
const createProjectExecution = useMutationCallback(() =>
  backendMutationOptions(backend.value, 'createProjectExecution'),
)
const { copy } = useCopy()
const uploadFileToCloud = useUploadFileToCloud()
const uploadFileToLocal = useUploadFileToLocal(category)
const exportArchive = useExportArchive(backend, driveStore)
const newProject = useNewProject(backend, () => category.value.type)

const self = computed(() => permissions.tryFindSelfPermission(user.value, asset.permissions))
const encodedEnsoPath = computed(() => encodeURI(asset.ensoPath))
const canOpenLocally = computed(() => container.canOpenProjectLocally(backend.value.type))
const canOpenNatively = computed(() => container.canOpenProjectNatively(backend.value.type))
const disabledTooltip = computed(() =>
  !canOpenLocally.value ? getText('downloadToOpenWorkflow') : undefined,
)

const ownsThisAsset = computed(
  () => !isCloud.value || self.value?.permission === permissions.PermissionAction.own,
)
const canManageThisAsset = computed(
  () => asset.id !== USERS_DIRECTORY_ID && asset.id !== TEAMS_DIRECTORY_ID,
)
const managesThisAsset = computed(
  () => ownsThisAsset.value || self.value?.permission === permissions.PermissionAction.admin,
)
const canEditThisAsset = computed(
  () => managesThisAsset.value || self.value?.permission === permissions.PermissionAction.edit,
)
const canAddToThisDirectory = computed(
  () =>
    category.value.type !== 'recent' &&
    asset.type === backendModule.AssetType.directory &&
    canEditThisAsset.value,
)

const hasPasteData = computed(() => (driveStore.pasteData?.data.assets.length ?? 0) > 0)
const canPaste = computed(() => {
  const pasteData = driveStore.pasteData
  const [firstPasteDataId] = pasteData?.data.assets ?? []
  const pasteDataParentId =
    firstPasteDataId != null ? assetItems.getAsset(firstPasteDataId.id)?.parentId : null
  const pasteDataParent = pasteDataParentId != null ? assetItems.getAsset(pasteDataParentId) : null
  if (
    !pasteDataParent ||
    !pasteData ||
    !isCloud.value ||
    permissions.isTeamPath(pasteDataParent.ensoPath)
  ) {
    return true
  }
  return pasteData.data.assets.every((pasteAsset) => {
    const otherAsset = assetItems.getAsset(pasteAsset.id)
    if (!otherAsset) return false
    // Assume a user path; check the permissions.
    const permission = permissions.tryFindSelfPermission(user.value, otherAsset.permissions)
    return (
      permission != null && permissions.canPermissionModifyDirectoryContents(permission.permission)
    )
  })
})

const isRunningProject = computed(
  () =>
    asset.type === backendModule.AssetType.project &&
    backendModule.IS_OPENING_OR_OPENED[asset.projectState.type],
)
const canExecute = computed(
  () =>
    category.value.type !== 'trash' &&
    (!isCloud.value ||
      (self.value != null && permissions.PERMISSION_ACTION_CAN_EXECUTE[self.value.permission])),
)
const isOtherUserUsingProject = computed(
  () =>
    isCloud.value &&
    backendModule.assetIsProject(asset) &&
    asset.projectState.openedBy != null &&
    asset.projectState.openedBy !== user.value.email,
)
const canUploadToCloud = computed(() => user.value.plan !== backendModule.Plan.free)

const globalContextMenuEntries = useGlobalContextMenuEntries({
  backend,
  category: () => category.value.type,
  currentDirectoryId: () => currentDirectoryId,
  directoryId: () => (canAddToThisDirectory.value ? (asset.id as backendModule.DirectoryId) : null),
  doPaste: (id) => doPaste(id),
})

const MAX_DURATION_MAXIMUM_MINUTES = 180
const systemApi = window.api?.system

const entries = computed((): (ContextMenuEntry | false | null | undefined)[] => {
  const pasteMenuEntry: ContextMenuEntry | false = hasPasteData.value &&
    canPaste.value && {
      action: 'paste',
      doAction: () => {
        const directoryId =
          asset.type === backendModule.AssetType.directory ? asset.id : asset.parentId
        doPaste(directoryId)
      },
    }
  const copyIdEntry: ContextMenuEntry | false = showDeveloperIds.value && {
    color: 'accent',
    action: 'copyId',
    doAction: () => {
      void copy(asset.id)
    },
  }

  if (category.value.type === 'trash') {
    return !ownsThisAsset.value ?
        []
      : [
          pasteMenuEntry,
          {
            action: 'undelete',
            label: getText('restoreFromTrashShortcut'),
            doAction: () => {
              void restoreAssets({ ids: [asset.id], parentId: null })
            },
          },
          {
            action: 'delete',
            label: getText('deleteForeverShortcut'),
            doAction: () => {
              modals.closeAll()
              modals.open(ConfirmDeleteModal, {
                cannotUndo: true,
                actionText: getText('deleteTheAssetTypeTitleForever', asset.type, asset.title),
                onConfirm: async () => {
                  await deleteAssets([[asset.id], true])
                },
              })
            },
          },
          copyIdEntry,
        ]
  }
  if (!canManageThisAsset.value) return []
  return [
    (asset.type === backendModule.AssetType.datalink ||
      asset.type === backendModule.AssetType.file) && {
      action: 'useInNewProject',
      doAction: () => {
        void newProject({ templateName: asset.title, ensoPath: asset.ensoPath }, asset.parentId)
      },
    },
    asset.type === backendModule.AssetType.project &&
      canExecute.value &&
      !isRunningProject.value &&
      !isOtherUserUsingProject.value && {
        action: 'open',
        isDisabled: !canOpenLocally.value,
        tooltip: disabledTooltip.value,
        doAction: () => {
          container.openProjectLocally(asset, backend.value.type)
        },
      },
    asset.type === backendModule.AssetType.project &&
      isCloud.value &&
      localBackend != null && {
        action: 'run',
        isDisabled: !canOpenNatively.value,
        tooltip: disabledTooltip.value,
        doAction: () => {
          container.openProjectNatively(asset, backend.value.type)
        },
      },
    asset.type === backendModule.AssetType.project &&
      isCloud.value && {
        action: 'runAsTask',
        isDisabled: isFeatureUnderPaywall('scheduler'),
        doAction: () => {
          const timeZone = IanaTimeZone(preferredTimeZone.value)
          const startDateTime = toRfc3339(new Date(now(timeZone).toAbsoluteString()))
          void createProjectExecution([
            {
              startDate: startDateTime,
              endDate: null,
              parallelMode: 'ignore',
              maxDurationMinutes: MAX_DURATION_MAXIMUM_MINUTES,
              repeat: { type: 'none' },
              projectId: asset.id,
              timeZone,
              tag: undefined,
            },
            asset.title,
          ])
        },
      },
    asset.type === backendModule.AssetType.project &&
      canExecute.value &&
      isRunningProject.value &&
      !isOtherUserUsingProject.value && {
        action: 'close',
        doAction: () => {
          const tab: Tab = { type: 'project', id: asset.id }
          if (container.isTabOpened(tab)) container.closeTab(tab)
          // With no tab open, close it on the backend.
          else openedProjects.closeProject(asset.id, { asset, backendType: backend.value.type })
        },
      },
    isCloud.value && {
      action: 'label',
      doAction: () => {
        // It replaces the open modals, as React's `setModal` did. No anchor: React's popover sat at
        // the window's top-left corner, its row ref cleared as the menu closed (#198). Focus
        // returns to the row.
        const row = driveStore.contextMenuData?.triggerRef.current ?? null
        modals.closeAll()
        modals.open(ManageLabelsModal, {
          backend: backend.value,
          items: [asset],
          anchor: null,
          opener: row,
        })
      },
    },
    isUploadableAsset(asset) &&
      !isCloud.value &&
      localBackend != null && {
        isUnderPaywall: !canUploadToCloud.value,
        action: 'uploadToCloud',
        feature: 'uploadToCloud',
        doAction: () => {
          void uploadFileToCloud(localBackend, {
            assets: [asset],
            targetDirectoryId: user.value.rootDirectoryId,
          })
        },
      },
    isUploadableAsset(asset) &&
      isCloud.value &&
      localBackend != null && {
        action: 'downloadToLocal',
        doAction: () => {
          void uploadFileToLocal([asset])
        },
      },
    {
      action: 'copy',
      doAction: () => {
        doCopy()
      },
    },
    !isRunningProject.value &&
      !isOtherUserUsingProject.value && {
        action: 'cut',
        doAction: () => {
          doCut()
        },
      },
    pasteMenuEntry,
    (isCloud.value ?
      asset.type !== backendModule.AssetType.directory
    : asset.type === backendModule.AssetType.project) && {
      isDisabled: asset.type === backendModule.AssetType.secret,
      action: 'download',
      doAction: () => {
        void downloadAssets({
          ids: [{ id: asset.id, title: asset.title }],
          targetDirectoryId:
            !isCloud.value ? categories.categoryDirectoryId({ type: 'local' }) : null,
          shouldUnpackProject: false,
        })
      },
    },
    canExecute.value &&
      !isRunningProject.value &&
      !isOtherUserUsingProject.value && {
        action: 'rename',
        doAction: () => {
          driveStore.update({ assetToRename: asset.id })
        },
      },
    (asset.type === backendModule.AssetType.secret ||
      asset.type === backendModule.AssetType.datalink) &&
      canEditThisAsset.value && {
        action: 'edit',
        doAction: () => {
          rightPanel.setTemporaryTab('settings')
          rightPanel.updateContext({ type: 'drive' }, (ctx) => {
            ctx.category = category.value
            ctx.item = asset
            switch (asset.type) {
              case backendModule.AssetType.secret:
              case backendModule.AssetType.datalink:
                ctx.spotlightOn = asset.type
                break
            }
            return ctx
          })
        },
      },
    asset.type === backendModule.AssetType.project && {
      action: 'duplicate',
      doAction: () => {
        void copyAssets([[asset.id], asset.parentId])
      },
    },
    {
      action: 'exportArchive',
      doAction: () => {
        void exportArchive()
      },
    },
    ...(canAddToThisDirectory.value ? globalContextMenuEntries.value : []),
    ownsThisAsset.value &&
      !isRunningProject.value &&
      !isOtherUserUsingProject.value && {
        action: 'delete',
        label: isCloud.value ? getText('moveToTrashShortcut') : getText('deleteShortcut'),
        doAction: () => {
          const textId = isCloud.value ? 'trashTheAssetTypeTitle' : 'deleteTheAssetTypeTitle'
          modals.closeAll()
          modals.open(ConfirmDeleteModal, {
            actionText: getText(
              textId,
              getText(backendModule.ASSET_TYPE_TO_TEXT_ID[asset.type]),
              asset.title,
            ),
            onConfirm: async () => {
              await deleteAssets([[asset.id], false])
            },
          })
        },
      },
    !isCloud.value &&
      systemApi != null && {
        action: 'openInFileBrowser',
        doAction: () => {
          systemApi.showItemInFolder(encodedEnsoPath.value)
        },
      },
    {
      action: 'copyAsPath',
      doAction: () => {
        void copy(encodedEnsoPath.value)
      },
    },
    copyIdEntry,
  ]
})

const presentEntries = useMenuEntries(entries, () => bindingTarget)
</script>

<template>
  <ContextMenu
    v-model:open="open"
    :ariaLabel="getText('assetContextMenuLabel')"
    :entries="presentEntries"
    :position="position"
    @close="emit('close')"
  />
</template>
