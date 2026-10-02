<script setup lang="ts">
/**
 * @file The "Logging out" and "Reconnecting session" overlays: modal, not dismissable, a spinner
 * and a title. `ProtectedLayout.vue` loads this asynchronously, so that the dialog code (Reka) is
 * not on the critical path of every route, the login page included; it is fetched right after the
 * layout renders, long before a logout.
 */
import Dialog from '$/components/Dialog/Dialog.vue'
import Result from '$/components/Result/Result.vue'
import { useSession } from '$/providers/session'
import { useText } from '$/providers/text'
import { computed } from 'vue'

const session = useSession()
const { getText } = useText()

const isReconnecting = computed(() => session.isReconnectingSession && !session.isLoggingOut)
</script>

<template>
  <Dialog
    :open="session.isLoggingOut"
    :aria-label="getText('loggingOut')"
    :isDismissable="false"
    isKeyboardDismissDisabled
    hideCloseButton
  >
    <Result status="loading" :title="getText('loggingOut')" />
  </Dialog>

  <Dialog
    :open="isReconnecting"
    :aria-label="getText('reconnectingSession')"
    :isDismissable="false"
    isKeyboardDismissDisabled
    hideCloseButton
  >
    <Result status="loading" :title="getText('reconnectingSession')" />
  </Dialog>
</template>
