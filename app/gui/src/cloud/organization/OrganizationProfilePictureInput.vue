<script setup lang="ts">
/**
 * @file The organization's profile picture on the Organization settings tab, which uploads a new
 * one when clicked.
 */
import Form from '$/components/Form/Form.vue'
import FormError from '$/components/Form/FormError.vue'
import HiddenFile from '$/components/Inputs/HiddenFile.vue'
import ProfilePicture from '$/components/ProfilePicture/ProfilePicture.vue'
import StatelessSpinner from '$/components/Spinner/StatelessSpinner.vue'
import { useBackends } from '$/providers/backends'
import { useText } from '$/providers/text'
import { backendMutationOptions, backendQueryOptions } from '@/composables/backend'
import { useMutation, useQuery } from '@tanstack/vue-query'
import { z } from 'zod'

const { remoteBackend } = useBackends()
const { getText } = useText()

const organization = useQuery(backendQueryOptions('getOrganization', [], remoteBackend))
const uploadOrganizationPicture = useMutation(
  backendMutationOptions('uploadOrganizationPicture', remoteBackend),
)

const schema = z.object({
  picture: z.instanceof(File).refine((file) => file.type.startsWith('image/')),
})

async function upload({ picture }: z.output<typeof schema>) {
  await uploadOrganizationPicture.mutateAsync([{ fileName: picture.name }, picture])
}
</script>

<template>
  <Form :schema="schema" @submit="upload">
    <label
      data-testid="organization-profile-picture-input"
      class="relative flex h-profile-picture-large w-profile-picture-large cursor-pointer items-center rounded-full transition-colors has-[:focus-visible]:focus-ring hover:bg-frame"
    >
      <StatelessSpinner
        v-if="uploadOrganizationPicture.isPending.value"
        phase="loading-medium"
        class="absolute -inset-1"
        :thickness="0.5"
      />
      <ProfilePicture
        :picture="organization.data.value?.picture"
        :name="organization.data.value?.name ?? ''"
        size="large"
        class="pointer-events-none h-full w-full"
      />
      <HiddenFile autoSubmit name="picture" accept="image/*" />
    </label>
    <span class="w-profile-picture-caption py-profile-picture-caption-y">
      {{ getText('organizationProfilePictureWarning') }}
    </span>
    <FormError />
  </Form>
</template>
