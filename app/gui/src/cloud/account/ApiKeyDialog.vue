<script setup lang="ts">
/**
 * @file The dialog shown once an API key is created: its id and its secret, each with a button that
 * copies it, and a warning that the secret is shown only this once. It opens on the modal stack
 * (`$/providers/modals`) and emits `close` once it has closed.
 */
import Alert from '$/components/Alert/Alert.vue'
import CopyButton from '$/components/Button/CopyButton.vue'
import Dialog from '$/components/Dialog/Dialog.vue'
import { useText } from '$/providers/text'
import type { ApiKey } from 'enso-common/src/services/Backend'
import { ref } from 'vue'

const { apiKey } = defineProps<{ apiKey: ApiKey }>()

const emit = defineEmits<{
  /** It has closed: the modal stack drops it. */
  close: []
}>()

const { getText } = useText()

const open = ref(true)
</script>

<template>
  <Dialog
    v-model:open="open"
    size="xlarge"
    type="modal"
    :title="getText('keyId')"
    @closed="emit('close')"
  >
    <div class="relative flex items-center gap-4">
      <div class="flex flex-col">
        <Alert variant="outline" icon="warning">{{ getText('accessKeyAlert') }}</Alert>
        <table>
          <tbody>
            <tr>
              <td>{{ getText('keyId') }}</td>
              <td>{{ getText('secretId') }}</td>
            </tr>
            <tr>
              <td>
                <CopyButton :copyText="apiKey.id" size="small">{{ apiKey.id }}</CopyButton>
              </td>
              <td>
                <CopyButton :copyText="apiKey.secretId ?? ''" size="small">
                  {{ apiKey.secretId }}
                </CopyButton>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </Dialog>
</template>
