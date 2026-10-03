<script setup lang="ts">
/**
 * @file The dialog asking a team or enterprise admin to name their organization: the Vue port of
 * the React `SetupOrganizationModal` and `SetupOrganizationForm` (`#/modals/SetupOrganizationForm`),
 * with the same title, text, field and buttons.
 *
 * `AppContainerLayout.vue` shows it while the organization has no name (through the modals
 * `registerCloud` contributes). Submitting names the organization and creates its default user
 * group of the same name; the layout then stops showing it. Like React's, it can be dismissed.
 */
import Dialog from '$/components/Dialog/Dialog.vue'
import Form from '$/components/Form/Form.vue'
import FormError from '$/components/Form/FormError.vue'
import Submit from '$/components/Form/Submit.vue'
import Input from '$/components/Inputs/Input.vue'
import Text from '$/components/Text/Text.vue'
import { ORGANIZATION_NAME_MAX_LENGTH, ORGANIZATION_NAME_MIN_LENGTH } from '$/appUtils'
import { useBackends } from '$/providers/backends'
import { useText } from '$/providers/text'
import { backendMutationOptions } from '@/composables/backend'
import { useMutation } from '@tanstack/vue-query'
import { ref } from 'vue'

const { getText } = useText()
const { remoteBackend } = useBackends()

const updateOrganization = useMutation(backendMutationOptions('updateOrganization', remoteBackend))
const createDefaultUserGroup = useMutation(backendMutationOptions('createUserGroup', remoteBackend))

// Opens as it mounts, as React's `defaultOpen` did.
const open = ref(true)

async function setUp({ name }: { name: string }) {
  await updateOrganization.mutateAsync([{ name }])
  await createDefaultUserGroup.mutateAsync([{ name }])
}
</script>

<template>
  <Dialog v-model:open="open" :title="getText('setupOrganization')">
    <Form
      gap="medium"
      class="max-w-96"
      :defaultValues="{ name: '' }"
      :schema="
        (z) =>
          z.object({
            name: z
              .string()
              .min(ORGANIZATION_NAME_MIN_LENGTH, getText('organizationNameMinLengthError'))
              .max(ORGANIZATION_NAME_MAX_LENGTH),
          })
      "
      @submit="setUp"
    >
      <Text>{{ getText('setOrganizationNameDescription') }}</Text>
      <Input
        name="name"
        autoFocus
        inputmode="text"
        autocomplete="off"
        :label="getText('organizationNameSettingsInput')"
        :description="
          getText('organizationNameSettingsInputDescription', ORGANIZATION_NAME_MAX_LENGTH)
        "
      />

      <Submit />

      <FormError />
    </Form>
  </Dialog>
</template>
