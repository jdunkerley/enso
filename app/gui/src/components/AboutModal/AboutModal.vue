<script setup lang="ts">
/**
 * @file The "About Enso" dialog: the app's edition and versions, with a button to copy them. The Vue
 * port of the React `AboutModal`, with the same dialog, text and layout.
 *
 * `App.vue` mounts it once, and the app menu's About item, the user menu and the info menu open it
 * through {@link openAboutModal} (`./aboutModal.ts`).
 */
import CopyButton from '$/components/Button/CopyButton.vue'
import Dialog from '$/components/Dialog/Dialog.vue'
import type { FocusReturnTarget } from '$/components/Dialog/focusReturn'
import Icon from '$/components/Icon/Icon.vue'
import Heading from '$/components/Text/Heading.vue'
import Text from '$/components/Text/Text.vue'
import { useBackends } from '$/providers/backends'
import { useText } from '$/providers/text'
import type { TextId } from 'enso-common/src/text'
import { computed } from 'vue'

const open = defineModel<boolean>('open', { default: false })

const { opener } = defineProps<{
  /** Where focus returns on closing (`openAboutModal` notes it). */
  opener?: FocusReturnTarget | undefined
}>()

const { localBackend } = useBackends()
const { getText } = useText()

const versionsEntries = computed((): readonly (readonly [TextId, string])[] => [
  ...(window.api != null ?
    ([
      ['version', window.api.versionInfo.version],
      ['build', window.api.versionInfo.build],
      ['electronVersion', window.api.versionInfo.electron],
      ['chromeVersion', window.api.versionInfo.chrome],
    ] as const)
  : [
      ...($config.VERSION == null ? [] : ([['version', $config.VERSION]] as const)),
      ...($config.COMMIT_HASH == null ? [] : ([['build', $config.COMMIT_HASH]] as const)),
    ]),
  ['userAgent', navigator.userAgent],
])

const copyText = computed(() =>
  versionsEntries.value.map(([textId, version]) => `${getText(textId)} ${version}`).join('\n'),
)
</script>

<template>
  <Dialog
    v-model:open="open"
    :title="getText('aboutThisAppShortcut')"
    size="large"
    :opener="opener"
  >
    <div class="relative flex flex-col items-center gap-4">
      <Icon icon="enso_logo" class="size-16 shrink-0" />

      <div class="flex flex-col items-center gap-2">
        <Heading>
          {{
            localBackend != null ? getText('appNameDesktopEdition') : getText('appNameCloudEdition')
          }}
        </Heading>

        <table class="self-stretch">
          <tbody>
            <tr v-for="[textId, version] in versionsEntries" :key="textId">
              <td class="pr-cell-x align-text-top">
                <Text nowrap>{{ getText(textId) }}</Text>
              </td>
              <td>
                <Text class="break-words [word-break:break-word]">{{ version }}</Text>
              </td>
            </tr>
          </tbody>
        </table>

        <CopyButton :copyText="copyText" size="medium" variant="submit">
          {{ getText('copy') }}
        </CopyButton>
      </div>
    </div>
  </Dialog>
</template>
