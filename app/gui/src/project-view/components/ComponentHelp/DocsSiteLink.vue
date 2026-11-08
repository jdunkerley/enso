<script setup lang="ts">
import {
  suggestionDocumentationUrl,
  type SuggestionEntry,
} from '$/providers/openedProjects/suggestionDatabase/entry'
import { useText } from '$/providers/text'
import { computed } from 'vue'

const { entry } = defineProps<{ entry: SuggestionEntry | undefined }>()
const { getText } = useText()

/**
 * The entry's page on the documentation site: the `Standard.*` libraries have one; the user's own
 * code and conversions do not, and nothing does without a configured site.
 */
const url = computed(() => {
  const base = $config.DOCS_URL
  return base && entry ? suggestionDocumentationUrl(entry, base) : undefined
})

function open(href: string) {
  window.open(href, '_blank')
}
</script>

<template>
  <a
    v-if="url"
    class="DocsSiteLink"
    :href="url"
    target="_blank"
    rel="noopener noreferrer"
    :aria-label="getText('viewOnDocsSiteLabel')"
    @click.prevent="open(url)"
    v-text="getText('viewOnDocsSite')"
  />
</template>

<style scoped>
.DocsSiteLink {
  flex: none;
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
  color: var(--docs-link);
  text-decoration: underline;
  text-underline-offset: 2px;
  margin-right: 4px;
  border-radius: 2px;

  &:focus-visible {
    outline: 2px solid var(--docs-link);
    outline-offset: 2px;
  }
}
</style>
