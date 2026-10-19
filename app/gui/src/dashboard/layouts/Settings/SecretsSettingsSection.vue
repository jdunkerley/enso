<script setup lang="ts">
/**
 * @file The Local tab's Secrets section: the names of the local secrets (never a value), with
 * buttons to create one, change a value or delete one; a button to copy the secrets key; and, when
 * the key is missing or does not fit the secrets file, a message with a reset.
 *
 * Values only ever go one way: into the secrets file. The only thing that comes back is the key,
 * and only through Electron main, which writes it to the clipboard.
 */
import ConfirmDeleteModal from '$/components/AlertDialog/ConfirmDeleteModal.vue'
import Button from '$/components/Button/Button.vue'
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import Text from '$/components/Text/Text.vue'
import { useModals } from '$/providers/modals'
import { useSettingsContext } from '$/providers/settingsContext'
import { useText } from '$/providers/text'
import { useToasts } from '$/providers/toasts'
import UpsertSecretModal from '$/secrets/UpsertSecretModal.vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { SecretId } from 'enso-common/src/services/Backend'
import { getMessageOrToString } from 'enso-common/src/utilities/errors'
import { computed } from 'vue'

const LIST_KEY = ['localSecrets', 'list'] as const
const STATUS_KEY = ['localSecrets', 'status'] as const

const context = useSettingsContext()
const { getText } = useText()
const toasts = useToasts()
const modals = useModals()
const queryClient = useQueryClient()

const backend = computed(() => context.value.localBackend)

const listQuery = useQuery({
  queryKey: LIST_KEY,
  queryFn: async () => (await backend.value?.listSecrets()) ?? [],
  enabled: computed(() => backend.value != null),
})
const statusQuery = useQuery({
  queryKey: STATUS_KEY,
  queryFn: async () => (await backend.value?.secretsStatus()) ?? null,
  enabled: computed(() => backend.value != null),
})
const secrets = computed(() => listQuery.data.value ?? [])
const status = computed(() => statusQuery.data.value ?? null)
const keyUnusable = computed(
  () => status.value?.state === 'missing' || status.value?.state === 'wrong',
)

/** Show a failure as a toast. */
function showError(error: unknown) {
  toasts.show(getMessageOrToString(error), { type: 'error' })
}

function refetch() {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: LIST_KEY }),
    queryClient.invalidateQueries({ queryKey: STATUS_KEY }),
  ])
}

const save = useMutation({
  mutationFn: async ({ name, value, isNew }: { name: string; value: string; isNew: boolean }) => {
    if (isNew) {
      await backend.value?.createSecret({ name, value, parentDirectoryId: null })
    } else {
      await backend.value?.updateSecret(SecretId(`local:${name}`), { title: null, value }, name)
    }
  },
  onError: showError,
  onSettled: refetch,
})

const remove = useMutation({
  mutationFn: async (name: string) => {
    await backend.value?.deleteLocalSecret(name)
  },
  onError: showError,
  onSettled: refetch,
})

const copyKey = useMutation({
  mutationFn: async () => {
    if (await window.api?.secrets.copyKey()) {
      toasts.show(getText('secretsKeyCopied'), { type: 'success' })
    }
  },
  onError: showError,
})

const reset = useMutation({
  mutationFn: async () => {
    await window.api?.secrets.reset()
  },
  onError: showError,
  onSettled: refetch,
})

function newSecret() {
  modals.open(UpsertSecretModal, {
    onCreate: (name: string, value: string) => save.mutate({ name, value, isNew: true }),
  })
}

function changeValue(name: string) {
  modals.open(UpsertSecretModal, {
    secretId: SecretId(`local:${name}`),
    name,
    onCreate: (_name: string, value: string) => save.mutate({ name, value, isNew: false }),
  })
}

async function askDelete(name: string) {
  const answer = await modals.ask(ConfirmDeleteModal, {
    cannotUndo: true,
    actionText: getText('secretsDeleteActionText', name),
    actionButtonLabel: getText('delete'),
  })
  if (answer === 'confirm') remove.mutate(name)
}

async function askCopyKey() {
  const answer = await modals.ask(ConfirmDeleteModal, {
    alert: getText('secretsCopyKeyWarning'),
    actionText: getText('secretsCopyKey').toLowerCase(),
    actionButtonLabel: getText('secretsCopyKey'),
  })
  if (answer === 'confirm') copyKey.mutate()
}

async function askReset() {
  const answer = await modals.ask(ConfirmDeleteModal, {
    cannotUndo: true,
    actionText: getText('secretsResetActionText'),
    actionButtonLabel: getText('secretsReset'),
  })
  if (answer === 'confirm') reset.mutate()
}
</script>

<template>
  <div v-if="backend != null" class="flex flex-col gap-2" data-testid="local-secrets-section">
    <Text v-if="keyUnusable">
      {{ getText(status?.state === 'missing' ? 'secretsKeyMissing' : 'secretsKeyWrong') }}
    </Text>
    <Text v-else-if="secrets.length === 0 && listQuery.isSuccess.value">
      {{ getText('secretsNone') }}
    </Text>
    <ul v-else class="flex flex-col gap-1">
      <li
        v-for="secret in secrets"
        :key="secret.id"
        class="flex items-center gap-2"
        :data-secret-name="secret.name"
      >
        <Text class="grow">{{ secret.name }}</Text>
        <ButtonGroup class="grow-0">
          <Button size="small" variant="outline" @press="changeValue(secret.name)">
            {{ getText('secretsChangeValue') }}
          </Button>
          <Button size="small" variant="outline" @press="askDelete(secret.name)">
            {{ getText('delete') }}
          </Button>
        </ButtonGroup>
      </li>
    </ul>
    <Text v-if="status?.keyFromEnvironment">{{ getText('secretsKeyFromEnvironment') }}</Text>
    <ButtonGroup class="grow-0">
      <Button v-if="!keyUnusable" size="small" variant="outline" @press="newSecret">
        {{ getText('newSecret') }}
      </Button>
      <Button v-if="!keyUnusable" size="small" variant="outline" @press="askCopyKey">
        {{ getText('secretsCopyKey') }}
      </Button>
      <Button v-if="keyUnusable" size="small" variant="outline" @press="askReset">
        {{ getText('secretsReset') }}
      </Button>
    </ButtonGroup>
  </div>
</template>
