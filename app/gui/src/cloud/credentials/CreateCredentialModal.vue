<script setup lang="ts">
/**
 * @file The "New Credential" dialog: a list of the credential types, and the chosen type's form
 * (`credentialInfos.ts`). The Vue port of the React `CreateCredentialModal`, with the same title,
 * size, list and forms.
 *
 * It is meant for the modal stack (`useModals().open`, as the Vue drive opens it), and opens as it
 * mounts; it emits `close` once it has closed and its exit animation has ended. As in React an
 * outside click does not close it; Escape does. Submitting a form creates the credential with
 * `doCreate`, opens the provider's sign-in page in the browser, and closes it.
 */
import { makeCredentialCreationHandler } from '$/cloud/serviceCredentials/logic'
import Dialog from '$/components/Dialog/Dialog.vue'
import Dropdown from '$/components/Inputs/Dropdown.vue'
import Text from '$/components/Text/Text.vue'
import { useText } from '$/providers/text'
import type { CredentialConfig, SecretId } from 'enso-common/src/services/Backend'
import { computed, ref } from 'vue'
import { CREDENTIAL_INFOS } from './credentialInfos'

const { doCreate } = defineProps<{
  doCreate: (name: string, value: CredentialConfig) => Promise<SecretId>
}>()

const emit = defineEmits<{
  /** It has closed: the modal stack drops it. */
  close: []
}>()

const { getText } = useText()
const open = ref(true)
const selectedIndex = ref<number | null>(0)
const selectedItem = computed(() =>
  selectedIndex.value == null ? undefined : CREDENTIAL_INFOS[selectedIndex.value],
)
const createCredentials = makeCredentialCreationHandler((name, value) => doCreate(name, value))
</script>

<template>
  <Dialog
    v-model:open="open"
    :title="getText('newCredential')"
    :isDismissable="false"
    size="xlarge"
    @closed="emit('close')"
  >
    <Dropdown
      v-model:selectedIndex="selectedIndex"
      :ariaLabel="getText('credentialTypeLabel')"
      :items="CREDENTIAL_INFOS"
      class="w-full self-start"
    >
      <template #default="{ item }">
        <Text>{{ getText(item.nameId) }}</Text>
      </template>
    </Dropdown>
    <component :is="selectedItem.form" v-if="selectedItem" :createCredentials="createCredentials" />
  </Dialog>
</template>
