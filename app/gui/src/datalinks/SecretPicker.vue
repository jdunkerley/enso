<script setup lang="ts">
/**
 * @file The datalink editor's picker for a secure value that is a secret: a dropdown of the local
 * secrets' names, and **New secret…**, which opens the create dialog and then selects what it
 * made. The value is a `secret://<name>` path, and never a secret's value: nothing here reads one.
 *
 * With no local backend (the browser build) or `readOnly`, the dropdown is disabled and only shows
 * the current path. A path that is not one of the local secrets (a cloud `enso://` path from an
 * old datalink, or a secret since deleted) is kept and shown as it is, until another is picked.
 * When the secrets cannot be listed (locked, or a different key), the reason is shown under it.
 */
import Dropdown from '$/components/Inputs/Dropdown.vue'
import Text from '$/components/Text/Text.vue'
import { useBackends } from '$/providers/backends'
import { useCreateLocalSecret, useLocalSecretsQuery } from '$/providers/localSecrets'
import { useModals } from '$/providers/modals'
import { useText } from '$/providers/text'
import { useToasts } from '$/providers/toasts'
import UpsertSecretModal from '$/secrets/UpsertSecretModal.vue'
import { getMessageOrToString } from 'enso-common/src/utilities/errors'
import { computed } from 'vue'

const { value, readOnly = false } = defineProps<{
  /** The chosen secret's `secret://` path; empty when none is chosen yet. */
  value: string | null
  readOnly?: boolean | undefined
}>()

const emit = defineEmits<{ change: [path: string] }>()

const { getText } = useText()
const modals = useModals()
const toasts = useToasts()
const backends = useBackends()
const secretsQuery = useLocalSecretsQuery(() => backends.localBackend)
const createSecret = useCreateLocalSecret(() => backends.localBackend)

/** The dropdown's items: `path` is `null` for **New secret…**. */
interface Item {
  readonly label: string
  readonly path: string | null
}

const loadError = computed(() => secretsQuery.error.value?.message ?? null)
const disabled = computed(() => readOnly || backends.localBackend == null)
const items = computed<Item[]>(() => {
  const secrets = (secretsQuery.data.value ?? []).map((s) => ({ label: s.name, path: s.path }))
  const current = value
  if (current != null && current !== '' && !secrets.some((s) => s.path === current)) {
    secrets.push({ label: current, path: current })
  }
  return disabled.value ? secrets : (
      [...secrets, { label: getText('datalinkNewSecret'), path: null }]
    )
})
const selectedIndex = computed(() => {
  const index = items.value.findIndex((item) => item.path != null && item.path === value)
  return index === -1 ? null : index
})

function select(index: number | null) {
  const item = index == null ? undefined : items.value[index]
  if (item == null) return
  if (item.path != null) {
    if (item.path !== value) emit('change', item.path)
  } else {
    modals.open(UpsertSecretModal, {
      onCreate: (name: string, secretValue: string) =>
        createSecret.mutate(
          { name, value: secretValue },
          {
            onSuccess: (path: string) => emit('change', path),
            onError: (error: unknown) =>
              toasts.show(getMessageOrToString(error), { type: 'error' }),
          },
        ),
    })
  }
}
</script>

<template>
  <div class="flex w-full flex-col gap-1 self-start">
    <Dropdown
      :ariaLabel="getText('secret')"
      :readOnly="disabled"
      :items="items"
      :selectedIndex="selectedIndex"
      class="w-full"
      @update:selectedIndex="select"
    >
      <template #default="{ item }">
        <Text>{{ item.label }}</Text>
      </template>
    </Dropdown>
    <Text v-if="loadError != null" color="danger" testId="secret-picker-error">
      {{ getText('secretsLoadFailed', loadError) }}
    </Text>
  </div>
</template>
