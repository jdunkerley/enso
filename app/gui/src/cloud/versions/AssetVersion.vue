<script setup lang="ts">
/**
 * @file One version of an asset: its title, comment and tags, its date and author, and its
 * actions. A project's version also compares with the version before it ("See changes"), or with
 * any other one (the "Compare with" submenu).
 *
 * The tags collapse into one "N tags" tag when they would not fit beside the title at their minimum
 * width. That is measured on hidden copies of the title and of one tag, as React did.
 */
import Button from '$/components/Button/Button.vue'
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import Icon from '$/components/Icon/Icon.vue'
import DropdownMenu from '$/components/Menu/DropdownMenu.vue'
import MenuItem from '$/components/Menu/MenuItem.vue'
import MenuSubmenu from '$/components/Menu/MenuSubmenu.vue'
import { TEXT_WITH_ICON } from '$/components/patterns'
import Text from '$/components/Text/Text.vue'
import UserWithPopover from '$/components/UserWithPopover/UserWithPopover.vue'
import { useModals } from '$/providers/modals'
import { useText } from '$/providers/text'
import { useQuery } from '@tanstack/vue-query'
import { useElementBounding } from '@vueuse/core'
import {
  AssetType,
  type Backend,
  type DatalinkAsset,
  type FileAsset,
  type ProjectAsset,
} from 'enso-common/src/services/Backend'
import { toReadableIsoString } from 'enso-common/src/utilities/data/dateTime'
import { computed, ref } from 'vue'
import AddVersionTag from './AddVersionTag.vue'
import { useRemoveVersionTag, versionTagsQueryOptions } from './queries'
import { normalizeVersionComment, type DuplicateOptions, type Version } from './version'
import VersionComment from './VersionComment.vue'
import VersionCommentButton from './VersionCommentButton.vue'
import VersionDialog from './VersionDialog.vue'
import VersionTag from './VersionTag.vue'

const HEADER_GAP_PX = 8
const TAG_GAP_PX = 4
const MIN_TAG_WIDTH_CH = 8
const COMMENT_ACTION_BUTTON_WIDTH_BUDGET_PX = 24

const {
  version,
  otherVersions,
  item,
  backend,
  previousVersion,
  doRestore,
  doDuplicate,
  doUpdateComment,
  isUpdatingComment = false,
} = defineProps<{
  version: Version
  otherVersions: readonly Version[]
  item: DatalinkAsset | FileAsset | ProjectAsset
  backend: Backend
  previousVersion: Version | undefined
  doRestore: (version: Version) => unknown
  doDuplicate: (options?: DuplicateOptions) => unknown
  doUpdateComment: (version: Version, comment: string | null) => unknown
  isUpdatingComment?: boolean | undefined
}>()

const { getText } = useText()
const modals = useModals()
const textWithIcon = TEXT_WITH_ICON()

const versionComment = computed(() => normalizeVersionComment(version.comment))
const isProject = computed(() => item.type === AssetType.project)
const canRestore = computed(() => !version.isLatest)
const comparableVersions = computed(() =>
  otherVersions
    .map((other, index) => ({ ...other, number: otherVersions.length - index }))
    .filter((other) => other.versionId !== version.versionId),
)

const tagsQuery = useQuery(versionTagsQueryOptions(backend))
const availableTags = computed(() => tagsQuery.data.value ?? [])

const removeVersionTag = useRemoveVersionTag(backend)

function restore() {
  return doRestore(version)
}

function openComparison(compareVersion: Version) {
  if (item.type !== AssetType.project) return
  modals.open(VersionDialog, {
    open: true,
    version,
    compareVersion,
    backend,
    item,
    doRestore: !compareVersion.isLatest ? restore : undefined,
    doDuplicate,
  })
}

const header = ref<HTMLElement>()
const fullTitle = ref<InstanceType<typeof Text>>()
const minTag = ref<HTMLElement>()
const headerBounds = useElementBounding(header)
const fullTitleBounds = useElementBounding(() => fullTitle.value?.element)
const minTagBounds = useElementBounding(minTag)

// The tags' minimum width is that of the first tag, so it can be inaccurate, but is reasonable in
// practice.
const shouldCollapseTags = computed(() => {
  const tagCount = version.tags.length
  if (tagCount === 0) return false
  const minimumTagsWidth =
    tagCount * minTagBounds.width.value + Math.max(tagCount - 1, 0) * TAG_GAP_PX
  const addCommentButtonWidth =
    versionComment.value == null ? COMMENT_ACTION_BUTTON_WIDTH_BUDGET_PX : 0
  const requiredWidth =
    fullTitleBounds.width.value + HEADER_GAP_PX + addCommentButtonWidth + minimumTagsWidth
  // Before the first measurement every width is 0, and the tags start collapsed, as in React.
  return headerBounds.width.value === 0 || requiredWidth > headerBounds.width.value
})
</script>

<template>
  <div class="grid w-full select-none grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
    <div class="relative flex flex-1 flex-col">
      <VersionComment
        :comment="versionComment"
        :isUpdating="isUpdatingComment"
        :onUpdateComment="(comment) => doUpdateComment(version, comment)"
      >
        <template #default="{ isEditing, startEditing }">
          <div ref="header" class="flex min-w-0 items-center gap-2">
            <Text
              variant="body"
              :truncate="shouldCollapseTags ? true : undefined"
              :nowrap="!shouldCollapseTags"
              class="min-width-0 shrink-0"
            >
              {{ version.title }}
            </Text>
            <VersionCommentButton
              v-if="!isEditing && versionComment == null"
              icon="comment"
              :label="getText('assetVersions.addComment')"
              :isUpdating="isUpdatingComment"
              :onPress="startEditing"
            />
            <template v-if="version.tags.length > 0">
              <div v-if="shouldCollapseTags" class="min-w-0 shrink-0">
                <VersionTag>
                  <template #tooltip>
                    <div class="flex flex-col items-start gap-1 pl-2">
                      <Text
                        v-for="(tag, index) in version.tags"
                        :key="`${version.versionId}-tooltip-${index}`"
                        color="inherit"
                      >
                        {{ tag }}
                      </Text>
                    </div>
                  </template>
                  {{ getText('xTags', version.tags.length) }}
                </VersionTag>
              </div>
              <div v-else class="flex min-w-0 items-center gap-1">
                <!-- React also gave each tag `min-w-[8ch] max-w-[32ch]`, but built those class
                names at run time, so Tailwind never generated them: they had no effect. -->
                <div
                  v-for="(tag, index) in version.tags"
                  :key="`${version.versionId}-${tag}-${index}`"
                  class="min-w-0 shrink"
                >
                  <VersionTag
                    :tooltip="tag"
                    :onDelete="
                      tag !== getText('latestIndicator') ?
                        () => removeVersionTag(item.id, version.versionId, tag)
                      : undefined
                    "
                  >
                    {{ tag }}
                  </VersionTag>
                </div>
              </div>
            </template>
            <AddVersionTag
              :availableTags="availableTags"
              :item="item"
              :version="version"
              :backend="backend"
              :refetchAvailableTags="tagsQuery.refetch"
            />
          </div>

          <!-- Copies of the title and of one tag, measured for the tags' collapsing. -->
          <div class="pointer-events-none absolute h-0 overflow-hidden opacity-0">
            <Text ref="fullTitle" variant="body" nowrap>{{ version.title }}</Text>
            <span ref="minTag" class="inline-block" :style="{ width: `${MIN_TAG_WIDTH_CH}ch` }">
              <VersionTag class="w-full">{{
                version.tags[0] ?? getText('latestIndicator')
              }}</VersionTag>
            </span>
          </div>
        </template>
      </VersionComment>

      <div class="flex items-center gap-2">
        <div :class="textWithIcon.base({ gap: 'medium', className: 'flex-none' })">
          <Icon size="small" icon="calendar" :class="textWithIcon.icon()" />
          <Text elementType="time" variant="body-sm" :class="textWithIcon.text()">
            {{ toReadableIsoString(new Date(version.lastModified)) }}
          </Text>
        </div>
        <UserWithPopover v-if="version.user" :user="version.user" />
      </div>
    </div>

    <ButtonGroup
      direction="row"
      gap="joined"
      class="mt-1 shrink-0 grow-0 self-start"
      :buttonVariants="{ size: 'small', variant: 'outline' }"
    >
      <VersionDialog
        v-if="item.type === AssetType.project"
        :version="version"
        :compareVersion="previousVersion"
        :backend="backend"
        :item="item"
        :doRestore="canRestore ? restore : undefined"
        :doDuplicate="doDuplicate"
      >
        <template #trigger>
          <Button icon="compare">{{ getText('seeChanges') }}</Button>
        </template>
      </VersionDialog>
      <DropdownMenu>
        <template #trigger>
          <Button icon="chevron_down" iconPosition="end" variant="outline">
            <template v-if="!isProject" #default>{{ getText('actions') }}</template>
          </Button>
        </template>
        <MenuItem v-if="canRestore" icon="restore" @select="restore">
          {{ getText('restoreThisVersion') }}
        </MenuItem>
        <MenuItem icon="duplicate" @select="doDuplicate({ versionId: version.versionId })">
          {{ getText('duplicateThisVersion') }}
        </MenuItem>
        <MenuItem
          v-if="isProject"
          icon="copy"
          @select="doDuplicate({ start: true, versionId: version.versionId })"
        >
          {{ getText('duplicateAndOpen') }}
        </MenuItem>
        <MenuSubmenu
          v-if="isProject && comparableVersions.length > 0"
          icon="compare"
          :label="getText('compareVersionSubmenuLabel')"
        >
          <MenuItem
            v-for="comparableVersion in comparableVersions"
            :key="comparableVersion.versionId"
            @select="openComparison(comparableVersion)"
          >
            {{ comparableVersion.isLatest ? 'Latest' : comparableVersion.title }}
          </MenuItem>
        </MenuSubmenu>
      </DropdownMenu>
    </ButtonGroup>
  </div>
</template>
