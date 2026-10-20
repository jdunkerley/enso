<script setup lang="ts">
/**
 * @file The Local tab's Secrets section: the names of the local secrets (never a value), with
 * buttons to create one, change a value or delete one; a button to copy the secrets key; and, when
 * the key is missing or does not fit the secrets file, a message with a reset; and, for a key made
 * on this computer, a button to rotate it (with a note once it is over a year old). If the names or the
 * status cannot be read, it says so, rather than looking like there are no secrets.
 *
 * Values only ever go one way: into the secrets file. The only thing that comes back is the key,
 * and only through Electron main, which writes it to the clipboard.
 */
import ConfirmDeleteModal from '$/components/AlertDialog/ConfirmDeleteModal.vue'
import Button from '$/components/Button/Button.vue'
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import Text from '$/components/Text/Text.vue'
import CopySecretsKeyModal from '$/dashboard/layouts/Settings/CopySecretsKeyModal.vue'
import { isKeyDue } from '$/composables/secretsKeyReminder'
import { isSecretsBlockedByProjects } from '$/electronApi'
import {
  LOCAL_SECRETS_KEY,
  useCreateLocalSecret,
  useLocalSecretsQuery,
} from '$/providers/localSecrets'
import { useModals } from '$/providers/modals'
import { useOpenedProjects } from '$/providers/openedProjects'
import { useSettingsContext } from '$/providers/settingsContext'
import { useText } from '$/providers/text'
import { useToasts } from '$/providers/toasts'
import UpsertSecretModal from '$/secrets/UpsertSecretModal.vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { SecretId } from 'enso-common/src/services/Backend'
import { getMessageOrToString } from 'enso-common/src/utilities/errors'
import { computed } from 'vue'

const STATUS_KEY = [...LOCAL_SECRETS_KEY, 'status'] as const

const context = useSettingsContext()
const { getText } = useText()
const toasts = useToasts()
const modals = useModals()
const queryClient = useQueryClient()
const openedProjects = useOpenedProjects()

const backend = computed(() => context.value.localBackend)

const listQuery = useLocalSecretsQuery(backend)
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
/** Whether the key is a year old or more, whether or not a reminder was snoozed. */
const keyIsOld = computed(
  () =>
    status.value?.state === 'ready' &&
    !status.value.keyFromEnvironment &&
    status.value.keyCreated != null &&
    isKeyDue(status.value.keyCreated, new Date(), null),
)
/** Whether the key can be rotated here: it is ours, and it works. */
const canRotate = computed(
  () => status.value?.state === 'ready' && !status.value.keyFromEnvironment,
)
/** Rotation needs the engine stopped, so any project that is open, opening or closing blocks it. */
const projectsOpen = computed(() =>
  [...openedProjects.listProjects()].some(
    (project) => project.state.status !== 'not-opened' || project.nextTask != null,
  ),
)
/** Why the names or the status could not be read, or `null`. */
const loadError = computed(() => {
  const error = listQuery.error.value ?? statusQuery.error.value
  return error == null ? null : error.message
})

/** Show a failure as a toast. */
function showError(error: unknown) {
  toasts.show(getMessageOrToString(error), { type: 'error' })
}

function refetch() {
  return queryClient.invalidateQueries({ queryKey: LOCAL_SECRETS_KEY })
}

const create = useCreateLocalSecret(backend)

const save = useMutation({
  mutationFn: async ({ name, value }: { name: string; value: string }) => {
    await backend.value?.updateSecret(SecretId(`local:${name}`), { title: null, value }, name)
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
    } else {
      toasts.show(getText('secretsNoKeyToCopy'), { type: 'error' })
    }
  },
  onError: showError,
})

const reset = useMutation({
  mutationFn: async () => {
    await window.api?.secrets.reset()
  },
  onError: (error) => {
    if (isSecretsBlockedByProjects(error, 'reset')) {
      toasts.show(getText('secretsResetCloseProjects'), { type: 'error' })
    } else {
      showError(error)
    }
  },
  onSettled: refetch,
})

const rotate = useMutation({
  mutationFn: async () => {
    await window.api?.secrets.rotate()
    toasts.show(getText('secretsKeyRotated'), { type: 'success' })
  },
  onError: (error) => {
    if (isSecretsBlockedByProjects(error, 'rotate')) {
      toasts.show(getText('secretsRotateCloseProjects'), { type: 'error' })
    } else {
      showError(error)
    }
  },
  onSettled: refetch,
})

function newSecret() {
  modals.open(UpsertSecretModal, {
    onCreate: (name: string, value: string) =>
      create.mutate({ name, value }, { onError: showError }),
  })
}

function changeValue(name: string) {
  modals.open(UpsertSecretModal, {
    secretId: SecretId(`local:${name}`),
    name,
    onCreate: (_name: string, value: string) => save.mutate({ name, value }),
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
  const answer = await modals.ask(CopySecretsKeyModal, {})
  if (answer === 'confirm') copyKey.mutate()
}

async function askRotate() {
  const answer = await modals.ask(ConfirmDeleteModal, {
    cannotUndo: true,
    actionText: getText('secretsRotateActionText'),
    actionButtonLabel: getText('secretsRotateKey'),
  })
  if (answer === 'confirm') rotate.mutate()
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
    <Text v-if="loadError != null" color="danger" testId="local-secrets-error">
      {{ getText('secretsLoadFailed', loadError) }}
    </Text>
    <Text v-else-if="keyUnusable">
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
    <Text v-if="keyIsOld" testId="local-secrets-key-old">
      {{ getText('secretsKeyOld') }}
    </Text>
    <Text v-if="status?.keyFromEnvironment">{{ getText('secretsKeyFromEnvironment') }}</Text>
    <ButtonGroup class="grow-0">
      <Button v-if="!keyUnusable" size="small" variant="outline" @press="newSecret">
        {{ getText('newSecret') }}
      </Button>
      <Button v-if="!keyUnusable" size="small" variant="outline" @press="askCopyKey">
        {{ getText('secretsCopyKey') }}
      </Button>
      <Button
        v-if="canRotate"
        size="small"
        variant="outline"
        :isDisabled="projectsOpen"
        @press="askRotate"
      >
        {{ getText('secretsRotateKey') }}
      </Button>
      <Button v-if="keyUnusable" size="small" variant="outline" @press="askReset">
        {{ getText('secretsReset') }}
      </Button>
    </ButtonGroup>
    <Text v-if="canRotate && projectsOpen">{{ getText('secretsRotateCloseProjects') }}</Text>
  </div>
</template>
