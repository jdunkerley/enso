<script setup lang="ts">
/**
 * @file The user bar's "Invite" button, opening the invitation dialog: the Vue port of the React
 * `InviteUsersButton` (#83 left it React until the dialog was ported).
 */
import Button from '$/components/Button/Button.vue'
import { useText } from '$/providers/text'
import InviteUsersModal from './InviteUsersModal.vue'

const { getText } = useText()
</script>

<template>
  <InviteUsersModal>
    <template #trigger>
      <Button size="medium" variant="outline">{{ getText('invite') }}</Button>
    </template>
  </InviteUsersModal>
</template>
