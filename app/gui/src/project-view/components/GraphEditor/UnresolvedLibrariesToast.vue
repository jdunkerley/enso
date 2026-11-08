<script setup lang="ts">
/**
 * @file The content of a project's toast about the libraries it could not load, or the edition it
 * names but that is not installed (#600). When `editions/checkSwitch` says the installed edition
 * would load them, it offers to switch the project to it.
 */
import Button from '$/components/Button/Button.vue'
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import Text from '$/components/Text/Text.vue'
import { useText } from '$/providers/text'
import { computed } from 'vue'
import type { LibraryLoadFailure, response } from 'ydoc-shared/languageServerTypes'

const { failures, check, busy } = defineProps<{
  failures: readonly LibraryLoadFailure[]
  /** The answer of `editions/checkSwitch`, once it came. */
  check: response.CheckEditionSwitch | undefined
  busy: boolean
}>()
const emit = defineEmits<{ switch: [] }>()

const { getText } = useText()

const editionMissing = computed(() => failures.find((f) => f.kind === 'EditionNotFound'))
const libraries = computed(() => failures.filter((f) => f.library != null))

function describe(failure: LibraryLoadFailure): string {
  const library = failure.library ?? ''
  const version = failure.version ?? ''
  switch (failure.kind) {
    case 'NotInEdition':
      return getText('libraryNotInEdition', library)
    case 'DownloadFailed':
      return getText('libraryDownloadFailed', library, version, failure.message)
    case 'LocalMissing':
      return getText('libraryLocalMissing', library)
    default:
      return getText('libraryLoadingError', library, version, failure.message)
  }
}

/** Whether switching to the installed edition would help, and changes anything. */
const offer = computed(() => check?.resolves === true && check.current !== check.target)
const changes = computed(() =>
  (check?.changes ?? []).map((c) => `${c.library} ${c.from ?? '?'} → ${c.to}`).join(', '),
)
</script>

<template>
  <div class="flex flex-col gap-2" data-testid="unresolved-libraries-toast">
    <Text v-if="editionMissing">
      {{ getText('editionNotInstalled', editionMissing.version ?? '', check?.target || '…') }}
    </Text>
    <Text v-if="libraries.length > 0">
      {{ getText('librariesNotLoaded', libraries.map(describe).join(', ')) }}
    </Text>
    <template v-if="check == null && libraries.length > 0">
      <Text>{{ getText('editionSwitchChecking') }}</Text>
    </template>
    <template v-else-if="offer && check">
      <Text>{{ getText('editionSwitchOffer', check.target) }}</Text>
      <Text v-if="changes" data-testid="edition-switch-changes">{{ changes }}</Text>
      <ButtonGroup class="grow-0">
        <Button
          size="small"
          variant="outline"
          :isLoading="busy"
          testId="edition-switch-button"
          @press="emit('switch')"
        >
          {{ busy ? getText('editionSwitching') : getText('editionSwitchAndReopen') }}
        </Button>
      </ButtonGroup>
    </template>
    <Text v-else-if="check && check.stillMissing.length > 0">
      {{ getText('librariesInstallOrRemove', check.stillMissing.join(', ')) }}
    </Text>
  </div>
</template>
