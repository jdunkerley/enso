<script setup lang="ts">
/**
 * @file The page shown in place of the dashboard when running projects in the browser is disabled
 * (the `enableCloudExecution` feature flag is off): the Vue port of the React
 * `#/layouts/CloudBrowserDisabled`, with the same result, text and buttons.
 *
 * After `redirectDelayMs` (3 s) it opens the desktop app through its deep link (`enso://`, then
 * `redirectPath`), and its spinner turns into an info icon. The user can open the desktop app
 * themselves, or download it. Like the React `Page` around it, it shows the info bar at the top
 * right and mounts the modal host, both loaded on first use.
 */
import Button from '$/components/Button/Button.vue'
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import Result from '$/components/Result/Result.vue'
import Text from '$/components/Text/Text.vue'
import { OPEN_IDE_DEEPLINK } from '$/appUtils'
import { useText } from '$/providers/text'
import { download } from '$/utils/download'
import { getDownloadUrl } from '$/utils/github'
import { unsafeWriteValue } from '$/utils/write'
import { defineAsyncComponent, onScopeDispose, ref } from 'vue'

const DEFAULT_REDIRECT_DELAY_MS = 3_000

const { redirectDelayMs = DEFAULT_REDIRECT_DELAY_MS, redirectPath = '' } = defineProps<{
  /** The delay in milliseconds before redirecting to the desktop edition. */
  redirectDelayMs?: number | undefined
  /** The path to redirect to if the user is not a full user. */
  redirectPath?: string | undefined
}>()

/** Loaded on demand, as the React `Page` loads it: its popover pulls in Reka. */
const InfoBar = defineAsyncComponent(() => import('$/components/InfoBar/InfoBar.vue'))
/** Loaded on demand, as the React `Page` loads it: its error boundary pulls in Reka. */
const ModalHost = defineAsyncComponent(() => import('$/components/ModalHost/ModalHost.vue'))

const { getText } = useText()

const normalizedRedirectPath = redirectPath.startsWith('/') ? redirectPath.slice(1) : redirectPath
const path = OPEN_IDE_DEEPLINK + normalizedRedirectPath

const isRedirecting = ref(true)
const timeout = window.setTimeout(() => {
  unsafeWriteValue(window.location, 'href', path)
  isRedirecting.value = false
}, redirectDelayMs)
onScopeDispose(() => window.clearTimeout(timeout))

async function downloadIde() {
  const downloadUrl = await getDownloadUrl()
  if (downloadUrl != null) {
    void download({ url: downloadUrl })
  }
}
</script>

<template>
  <Result
    :status="isRedirecting ? 'loading' : 'info'"
    :title="getText('cloudBrowserDisabledTitle')"
    :subtitle="getText('cloudBrowserDisabledSubtitle')"
  >
    <ButtonGroup align="center" verticalAlign="center">
      <Button variant="primary" :href="path">{{ getText('openInDesktop') }}</Button>

      <Text>{{ getText('or') }}</Text>

      <Button variant="outline" @press="downloadIde">{{ getText('downloadIDE') }}</Button>
    </ButtonGroup>
  </Result>
  <div class="fixed right top z-1 m-2.5 text-primary">
    <InfoBar />
  </div>
  <ModalHost />
</template>
