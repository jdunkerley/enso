<script setup lang="ts">
/**
 * @file The "+" button after a version's tags, and its popover: a text field for a new tag, and
 * the organization's other tags as suggestions, filtered by what is typed. Enter or a suggestion
 * adds the tag; Escape closes the popover. The tag list is refetched whenever it opens.
 */
import Button from '$/components/Button/Button.vue'
import Popover from '$/components/Dialog/Popover.vue'
import BasicInput from '$/components/Inputs/BasicInput.vue'
import { useText } from '$/providers/text'
import { tv } from '$/utils/style/tailwindVariants'
import type { AnyAsset, Backend } from 'enso-common/src/services/Backend'
import { useFilter } from 'reka-ui'
import { computed, ref, watch } from 'vue'
import { useAddVersionTag } from './queries'
import type { Version } from './version'

const ADD_TAG_STYLES = tv({
  slots: {
    form: 'flex w-80 max-w-[min(20rem,calc(100vw-2rem))] flex-col gap-2',
    inputRow: 'flex items-center gap-2',
    input:
      'w-full rounded-full border-0.5 border-primary/20 bg-transparent px-3 py-1.5 text-xs text-primary outline-none transition-colors placeholder:text-primary/40 focus:border-primary',
    suggestions: 'flex max-h-56 flex-col overflow-y-auto overflow-x-hidden',
    suggestionButton:
      'w-full justify-start rounded-full px-3 py-1.5 text-left text-xs font-medium text-primary hover:bg-primary/5',
  },
})

const { availableTags, backend, item, version, refetchAvailableTags } = defineProps<{
  availableTags: readonly string[]
  backend: Backend
  item: AnyAsset
  version: Version
  refetchAvailableTags: () => Promise<unknown>
}>()

const { getText } = useText()
const styles = ADD_TAG_STYLES()
const { contains } = useFilter({ sensitivity: 'base' })
const addVersionTag = useAddVersionTag(backend)

const open = ref(false)
watch(open, (isOpen) => {
  if (isOpen) void refetchAvailableTags()
})

const value = ref('')
const normalizedValue = computed(() => value.value.trim())
const filteredTags = computed(() => {
  const existingTags = new Set(version.tags)
  return availableTags.filter(
    (tag) =>
      tag.trim() !== '' &&
      !existingTags.has(tag) &&
      (value.value.trim() === '' || contains(tag, value.value)),
  )
})

async function submit(tag: string, close: () => void) {
  const normalizedTag = tag.trim()
  if (normalizedTag === '' || version.tags.includes(normalizedTag)) return
  value.value = ''
  close()
  await addVersionTag(item.id, version.versionId, normalizedTag)
}

function onKeyDown(event: KeyboardEvent, close: () => void) {
  if (event.key === 'Enter') {
    event.preventDefault()
    void submit(normalizedValue.value, close)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    close()
  }
}
</script>

<template>
  <Popover v-model:open="open" size="auto" placement="bottom-start">
    <template #trigger>
      <Button
        variant="icon"
        size="xxsmall"
        icon="add"
        :tooltip="getText('assetVersions.addTag')"
        class="shrink-0 opacity-40 hover:opacity-100"
      />
    </template>
    <template #default="{ close }">
      <form :class="styles.form()" @submit.prevent="submit(normalizedValue, close)">
        <div :class="styles.inputRow()">
          <BasicInput
            :modelValue="value"
            autoFocus
            :placeholder="getText('assetVersions.addTag')"
            :aria-label="getText('assetVersions.addTag')"
            :class="styles.input()"
            @update:modelValue="value = String($event ?? '')"
            @keydown="onKeyDown($event, close)"
          />
        </div>
        <div v-if="filteredTags.length > 0" :class="styles.suggestions()">
          <Button
            v-for="tag in filteredTags"
            :key="tag"
            variant="custom"
            :class="styles.suggestionButton()"
            @press="submit(tag, close)"
          >
            {{ tag }}
          </Button>
        </div>
      </form>
    </template>
  </Popover>
</template>
