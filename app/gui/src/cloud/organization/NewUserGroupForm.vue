<script setup lang="ts">
/**
 * @file The "New User Group" popover: the group's name, which must not match an existing group's
 * (ignoring case and spacing), Submit and Cancel.
 */
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import DialogClose from '$/components/Dialog/DialogClose.vue'
import Form from '$/components/Form/Form.vue'
import FormError from '$/components/Form/FormError.vue'
import Submit from '$/components/Form/Submit.vue'
import Input from '$/components/Inputs/Input.vue'
import Text from '$/components/Text/Text.vue'
import { useBackends } from '$/providers/backends'
import { useText } from '$/providers/text'
import { normalizeName } from '$/utils/data/string'
import { backendMutationOptions } from '@/composables/backend'
import { useMutation, useQuery } from '@tanstack/vue-query'
import { computed } from 'vue'
import { listUserGroupsQueryOptions } from './queries'

const { getText } = useText()
const { remoteBackend } = useBackends()

const userGroupsQuery = useQuery(listUserGroupsQueryOptions(remoteBackend))
await userGroupsQuery.suspense()

const userGroupNames = computed(
  () => new Set((userGroupsQuery.data.value ?? []).map((group) => normalizeName(group.groupName))),
)
const createUserGroup = useMutation(backendMutationOptions('createUserGroup', remoteBackend))

async function createGroup({ name }: { name: string }) {
  await createUserGroup.mutateAsync([{ name }])
}
</script>

<template>
  <Form
    :schema="
      (z) =>
        z.object({
          name: z
            .string()
            .min(1)
            .refine(
              (name) => !userGroupNames.has(normalizeName(name)),
              getText('duplicateUserGroupError'),
            ),
        })
    "
    :defaultValues="{ name: '' }"
    method="dialog"
    @submit="createGroup"
  >
    <Text elementType="h1" variant="subtitle" balance>{{ getText('newUserGroup') }}</Text>
    <Input name="name" :label="getText('name')" />
    <ButtonGroup class="relative">
      <Submit />
      <DialogClose variant="outline">{{ getText('cancel') }}</DialogClose>
    </ButtonGroup>
    <FormError />
  </Form>
</template>
