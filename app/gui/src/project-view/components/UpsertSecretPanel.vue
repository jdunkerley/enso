<script setup lang="ts">
/**
 * @file The file browser's "New Secret" panel. Secrets exist only in the Enso Cloud, so the form is
 * cloud code (`$/cloud/credentials/`); this core component imports it directly until the cloud
 * contribution registries exist (see `src/cloud/CLAUDE.md`).
 */
import UpsertSecretForm from '$/cloud/credentials/UpsertSecretForm.vue'
import DashboardDialogContent from '@/components/DashboardDialogContent.vue'

const emit = defineEmits<{
  accepted: [value: string, name: string]
  canceled: []
}>()
</script>

<template>
  <DashboardDialogContent class="UpsertSecretPanel" heading="New Secret" :blockInteractions="true">
    <UpsertSecretForm
      cancel="emit"
      @create="(name, value) => emit('accepted', value, name)"
      @cancel="emit('canceled')"
    />
  </DashboardDialogContent>
</template>
