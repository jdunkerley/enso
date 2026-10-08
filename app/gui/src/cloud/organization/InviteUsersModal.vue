<script setup lang="ts">
/**
 * @file The "Invite" dialog: a form for the email addresses to invite, then a success step with the
 * invitation link. It is shared by every place that invites users: the Members settings tab, the
 * user bar's "Invite" (`InviteUsersButton.vue`), and any app-level modal that needs it.
 *
 * Its trigger is the `trigger` slot; without one it is controlled through `v-model:open`.
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
