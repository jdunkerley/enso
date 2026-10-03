<script setup lang="ts">
/**
 * @file The form inside `DuplicateAssetsModal.vue`: for each conflicting asset, the new and the
 * existing one side by side, and Skip, Replace (when allowed) or Rename; then Skip All (or "Skip
 * the rest") and Apply. The Vue port of the React `ResolveDuplicationsModalInner`.
 *
 * It waits in `setup` for the target directory's listings (its active and its trashed assets), so
 * it must be inside a `SuspenseLoader`, as `Dialog.vue`'s content is. When none of the assets
 * actually conflicts it emits `noConflicts` and renders nothing, as React did.
 *
 * The values are an array (`entries.N`), one entry per asset, where React keyed them by asset id:
 * a local asset's id is an encoded path, whose dots would read as nested fields.
 */
import Button from '$/components/Button/Button.vue'
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import DialogClose from '$/components/Dialog/DialogClose.vue'
import Popover from '$/components/Dialog/Popover.vue'
import FieldError from '$/components/Form/FieldError.vue'
import Form from '$/components/Form/Form.vue'
import FormError from '$/components/Form/FormError.vue'
import Submit from '$/components/Form/Submit.vue'
import { useForm } from '$/components/Form/useForm'
import Icon from '$/components/Icon/Icon.vue'
import Input from '$/components/Inputs/Input.vue'
import DropdownMenu from '$/components/Menu/DropdownMenu.vue'
import MenuItem from '$/components/Menu/MenuItem.vue'
import Separator from '$/components/Separator/Separator.vue'
import Text from '$/components/Text/Text.vue'
import type { Category } from '$/providers/category'
import { useDriveLocation } from '$/providers/drive'
import { useText } from '$/providers/text'
import { listDirectoryQueryOptions, unsafe_assetFromCacheQueryOptions } from '$/utils/driveQueries'
import { useQuery, useQueryClient } from '@tanstack/vue-query'
import {
  AssetType,
  FilterBy,
  ReplaceableAssetType,
  titleSchema,
  type AnyAsset,
  type AssetId,
  type Backend,
  type DirectoryId,
} from 'enso-common/src/services/Backend'
import { computed, onMounted, ref } from 'vue'
import AssetSummary from './AssetSummary.vue'
import { getUniqueName, type ResolvedDuplication } from './duplicateAssets'

const props = defineProps<{
  // `& string` names the runtime type for Vue's prop check, which cannot see through the brand.
  targetId: DirectoryId & string
  conflictingIds: readonly AssetId[]
  category?: Category | undefined
  backend?: Backend | undefined
  canReplace: boolean
}>()

const emit = defineEmits<{
  submit: [resolutions: readonly ResolvedDuplication[]]
  noConflicts: []
}>()

const { getText } = useText()
const queryClient = useQueryClient()

// The drive's location only when needed: a caller that names both may open it anywhere.
const driveLocation = props.category == null || props.backend == null ? useDriveLocation() : null
const listedCategory = props.category ?? driveLocation!.currentCategory
const backendOrNull = props.backend ?? driveLocation!.associatedBackend
if (backendOrNull == null) throw new Error('The drive has no backend to resolve duplicates in.')
const listedBackend: Backend = backendOrNull

const listingOptions = (filterBy?: FilterBy) =>
  listDirectoryQueryOptions({
    category: listedCategory,
    backend: listedBackend,
    parentId: props.targetId,
    ...(filterBy != null ? { filterBy } : {}),
    labels: null,
    sortExpression: null,
    sortDirection: null,
    refetchInterval: null,
  })
const activeQuery = useQuery({ ...listingOptions(), throwOnError: true })
const trashedQuery = useQuery({ ...listingOptions(FilterBy.trashed), throwOnError: true })
const [, , conflictingAssetsOrNull] = await Promise.all([
  activeQuery.suspense(),
  trashedQuery.suspense(),
  Promise.all(
    props.conflictingIds.map((assetId) =>
      queryClient.fetchQuery(
        unsafe_assetFromCacheQueryOptions({ backend: listedBackend, assetId, queryClient }),
      ),
    ),
  ),
])
const conflictingAssets = conflictingAssetsOrNull.filter((asset) => asset != null)

/** The directory's assets, active and trashed, and each by title (a trashed one wins). */
const siblingFiles = computed(() => {
  const map = new Map<string, AnyAsset>()
  const siblings: AnyAsset[] = []
  for (const query of [activeQuery, trashedQuery]) {
    for (const asset of query.data.value?.assets ?? []) {
      map.set(asset.title, asset)
      siblings.push(asset)
    }
  }
  return { map, siblings }
})
const siblingTitles = siblingFiles.value.siblings.map((sibling) => sibling.title)

const hasConflicts = conflictingAssets.some(
  (asset) => siblingFiles.value.map.get(asset.title) != null,
)

onMounted(() => {
  if (!hasConflicts) emit('noConflicts')
})

/** The existing asset each new one conflicts with. */
function existingSibling(asset: AnyAsset) {
  const sibling = siblingFiles.value.map.get(asset.title)
  if (sibling == null) throw new Error('Sibling was not found, this should never happen.')
  return sibling
}

const form = useForm({
  method: 'dialog',
  schema: (z) => {
    const assetId = z.custom<AssetId>()
    const entry = z
      .object({
        assetId,
        type: z.nativeEnum(AssetType),
        newName: z.string().trim(),
        conclusion: z.enum(['default', 'rename'], { message: getText('invalidConclusion') }),
      })
      .or(
        z.object({
          assetId,
          type: z.nativeEnum(AssetType),
          conclusion: z.literal('skip', { message: getText('invalidConclusion') }),
        }),
      )
      .or(
        z.object({
          assetId,
          type: z.nativeEnum(ReplaceableAssetType, { message: getText('invalidConclusion') }),
          conclusion: z.literal('replace', { message: getText('invalidConclusion') }),
        }),
      )
    return z.object({ entries: z.array(entry) })
  },
  defaultValues: {
    entries: conflictingAssets.map((asset) => ({
      assetId: asset.id,
      type: asset.type,
      conclusion: 'default' as const,
      newName: getUniqueName(asset.title, siblingTitles),
    })),
  },
  onSubmit: ({ entries }) => {
    emit(
      'submit',
      entries.map((entry): ResolvedDuplication => {
        switch (entry.conclusion) {
          case 'default':
          case 'rename':
            return { assetId: entry.assetId, conclusion: 'rename', newName: entry.newName }
          case 'replace':
          case 'skip':
            return { assetId: entry.assetId, conclusion: entry.conclusion }
        }
      }),
    )
  },
})

interface EntryValue {
  readonly assetId: AssetId
  readonly type: AssetType
  readonly conclusion: 'default' | 'rename' | 'replace' | 'skip'
  readonly newName?: string
}

/**
 * What each entry shows: its conclusion as last chosen with its own buttons. As in React, where
 * each entry rendered its controller's value, which a change of `entries.N.conclusion` alone did
 * not refresh, Skip All (and "Skip the rest") change the values that Apply submits, not what the
 * entries show.
 */
const entries = ref<readonly EntryValue[]>(form.getValues('entries') as readonly EntryValue[])

function entryPath(index: number) {
  return `entries.${index}` as const
}

function setConclusion(index: number, conclusion: EntryValue['conclusion'], newName?: string) {
  const current = entries.value[index]
  if (current == null) return
  const next = { ...current, conclusion, ...(newName != null ? { newName } : {}) }
  form.setValue(entryPath(index), next)
  entries.value = entries.value.map((entry, i) => (i === index ? next : entry))
}

function skipAll() {
  conflictingAssets.forEach((_asset, index) => {
    form.setValue(`${entryPath(index)}.conclusion`, 'skip', { shouldDirty: true })
  })
}

/**
 * As React's: an entry's conclusion is never unset (it starts as `default`), so this changes
 * nothing.
 */
function skipRest() {
  conflictingAssets.forEach((_asset, index) => {
    const conclusion = form.getValues(`${entryPath(index)}.conclusion`)
    if (conclusion == null) {
      form.setValue(`${entryPath(index)}.conclusion`, 'skip', { shouldDirty: true })
    }
  })
}
</script>

<template>
  <Form v-if="hasConflicts" :form="form" class="pb-20">
    <Text elementType="p">
      {{
        conflictingIds.length === 1 ?
          getText('resolveDuplicatesDescriptionOne')
        : getText('resolveDuplicatesDescriptionMany', conflictingIds.length)
      }}
    </Text>

    <template v-for="(asset, index) in conflictingAssets" :key="asset.id">
      <div
        class="grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] grid-rows-[auto_auto_auto] gap-2"
      >
        <AssetSummary :asset="asset" new />
        <Icon icon="arrow_right" size="medium" class="self-center" />
        <AssetSummary :asset="existingSibling(asset)" />

        <ButtonGroup class="col-span-full row-span-2 mt-1">
          <div v-if="entries[index]?.conclusion !== 'default'" class="flex items-center gap-2">
            <Text v-if="entries[index]?.conclusion === 'skip'">
              {{ getText('assetWillBeSkipped') }}
            </Text>
            <Text v-if="entries[index]?.conclusion === 'rename'">
              {{ getText('assetWillBeRenamed', entries[index]?.newName ?? '') }}
            </Text>
            <Text v-if="entries[index]?.conclusion === 'replace'">
              {{ getText('assetWillBeReplaced') }}
            </Text>
            <Button variant="link" @press="setConclusion(index, entries[index]!.conclusion)">
              {{ getText('change') }}
            </Button>
          </div>

          <ButtonGroup v-else :buttonVariants="{ size: 'xsmall' }">
            <Button variant="outline" class="min-w-16" @press="setConclusion(index, 'skip')">
              {{ getText('skip') }}
            </Button>
            <Button
              v-if="canReplace"
              variant="outline"
              class="min-w-16"
              @press="setConclusion(index, 'replace')"
            >
              {{ getText('replace') }}
            </Button>
            <Popover placement="bottom-start">
              <template #trigger>
                <Button variant="primary" class="min-w-16">{{ getText('rename') }}</Button>
              </template>
              <template #default="{ close }">
                <!-- Escape closes only this form, as react-aria's popover stopped it: on the page
                it would reach the dashboard's global Escape binding, which closes every modal. -->
                <Form
                  method="dialog"
                  :defaultValues="{
                    newName: String(form.getValues(`${entryPath(index)}.newName`)),
                  }"
                  :schema="
                    (z) =>
                      z.object({
                        newName: titleSchema({ id: asset.id, siblings: siblingFiles.siblings }),
                      })
                  "
                  @keydown.esc.stop="close()"
                  @submit="({ newName }) => setConclusion(index, 'rename', newName)"
                >
                  <Text>{{ getText('newNameDescription') }}</Text>
                  <Input :label="getText('newName')" name="newName" autoFocus="select" />
                  <Submit>{{ getText('apply') }}</Submit>
                  <FormError />
                </Form>
              </template>
            </Popover>
          </ButtonGroup>
        </ButtonGroup>

        <FieldError class="col-span-full row-span-3" :name="`${entryPath(index)}.conclusion`" />
      </div>

      <Separator v-if="index !== conflictingAssets.length - 1" class="my-2" />
    </template>

    <ButtonGroup
      class="fixed bottom-0 left-0 right-0 border-t-0.5 border-primary/20 bg-background/90 px-3 py-4 backdrop-blur-md"
    >
      <DialogClose variant="ghost" class="mr-auto">{{ getText('cancel') }}</DialogClose>

      <ButtonGroup direction="row" gap="joined" class="grow-0">
        <Button variant="outline" class="min-w-20" @press="skipAll">
          {{ getText('skipAll') }}
        </Button>
        <DropdownMenu placement="bottom-start" :offset="8">
          <template #trigger>
            <Button variant="outline" icon="chevron_down" />
          </template>
          <MenuItem @select="skipRest">{{ getText('skipRest') }}</MenuItem>
        </DropdownMenu>
      </ButtonGroup>

      <Submit class="min-w-20">{{ getText('apply') }}</Submit>
    </ButtonGroup>

    <FormError />
  </Form>
</template>
