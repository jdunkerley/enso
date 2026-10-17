<script setup lang="ts">
/**
 * @file The file browser's "New Secret" panel, over `$/secrets/UpsertSecretForm.vue`. Dormant:
 * secrets are cloud-only until local secrets exist, decision 5 of
 * `docs/superpowers/specs/2026-10-17-local-only-ide-design.md`.
 */
import UpsertSecretForm from '$/secrets/UpsertSecretForm.vue'
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
