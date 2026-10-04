<script setup lang="ts">
/**
 * @file The "Invite" dialog: a form for the email addresses to invite, then a success step with the
 * invitation link. The Vue port of the React `InviteUsersModal`, shared by every place that invites
 * users: the Members settings tab, the user bar's "Invite" (`InviteUsersButton.vue`), and any
 * app-level modal that needs it.
 *
 * Its trigger is the `trigger` slot, as React's `Dialog.Trigger`; without one it is controlled
 * through `v-model:open`. React's unused `relativeToTrigger` (a popover instead of a dialog) is not
 * ported.
 */
import Dialog from '$/components/Dialog/Dialog.vue'
import { useText } from '$/providers/text'
import InviteUsersSteps from './InviteUsersSteps.vue'

const open = defineModel<boolean>('open', { default: false })

const { getText } = useText()
</script>

<template>
  <Dialog v-model:open="open" :title="getText('invite')">
    <template v-if="$slots.trigger" #trigger><slot name="trigger" /></template>
    <template #default="{ close }">
      <InviteUsersSteps :onClose="close" />
    </template>
  </Dialog>
</template>
