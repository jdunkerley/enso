<script setup lang="ts">
/**
 * @file The "danger zone" of the Account settings tab, with the button that deletes the user's
 * account once confirmed: the Vue port of the React `DeleteUserAccountSettingsSection`.
 */
import Button from '$/components/Button/Button.vue'
import Dialog from '$/components/Dialog/Dialog.vue'
import Heading from '$/components/Text/Heading.vue'
import Text from '$/components/Text/Text.vue'
import { useAuth } from '$/providers/auth'
import { useText } from '$/providers/text'
import ConfirmDeleteUserForm from './ConfirmDeleteUserForm.vue'

const auth = useAuth()
const { getText } = useText()
</script>

<template>
  <div
    class="flex flex-col items-start gap-2.5 rounded-2.5xl border-2 border-danger px-[1rem] pb-[0.9375rem] pt-[0.5625rem]"
  >
    <Heading color="danger">{{ getText('dangerZone') }}</Heading>
    <div class="flex gap-2">
      <Dialog :title="getText('areYouSure')" role="alertdialog" class="items-center">
        <template #trigger>
          <Button size="medium" variant="delete">
            {{ getText('deleteUserAccountButtonLabel') }}
          </Button>
        </template>
        <ConfirmDeleteUserForm :doDelete="() => auth.deleteUser().then(() => {})" />
      </Dialog>
      <Text class="my-auto">{{ getText('deleteUserAccountWarning') }}</Text>
    </div>
  </div>
</template>
