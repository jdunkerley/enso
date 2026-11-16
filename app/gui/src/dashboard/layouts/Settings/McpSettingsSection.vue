<script setup lang="ts">
/**
 * @file The AI tab's External agents section: a switch for the MCP server that lets external
 * agent apps read the open project, with a warning about what a connected agent can do. While it is
 * on, the section shows the server's address, a port field, a button per client that copies that
 * client's setup text, and a button to replace the token. If the server could not start, the
 * reason shows under the switch. Under the copy buttons, a Claude Desktop block shows whether its
 * configuration file has the IDE's entry and offers to add or update it (Electron main edits the
 * file), and, for doing it by hand, a Copy JSON button with the file's path and what to do with it. While `ENSO_MCP_ENABLED` or `ENSO_MCP_PORT` fixes the setting
 * (`lockedByEnvironment`), the switch and the port field are disabled, with a note saying why.
 *
 * The token never reaches this component: "Copy setup" goes through Electron main, which writes the
 * text to the clipboard.
 */
import Alert from '$/components/Alert/Alert.vue'
import ConfirmDeleteModal from '$/components/AlertDialog/ConfirmDeleteModal.vue'
import Button from '$/components/Button/Button.vue'
import ButtonGroup from '$/components/Button/ButtonGroup.vue'
import Form from '$/components/Form/Form.vue'
import FormError from '$/components/Form/FormError.vue'
import Submit from '$/components/Form/Submit.vue'
import Input from '$/components/Inputs/Input.vue'
import Switch from '$/components/Switch/Switch.vue'
import Text from '$/components/Text/Text.vue'
import { useModals } from '$/providers/modals'
import { useText } from '$/providers/text'
import { useToasts } from '$/providers/toasts'
import { useMutation } from '@tanstack/vue-query'
import {
  MCP_CLIENT_KINDS,
  MCP_DEFAULT_PORT,
  type ClaudeDesktopStatus,
  type McpClientKind,
  type McpStatus,
} from 'enso-common/src/mcp'
import { getMessageOrToString } from 'enso-common/src/utilities/errors'
import { computed, onMounted, onScopeDispose, ref } from 'vue'
import McpClaudeDesktopConfirmModal from './McpClaudeDesktopConfirmModal.vue'

const MIN_PORT = 1024
const MAX_PORT = 65535

const CLIENT_LABEL_IDS = {
  claudeCode: 'mcpClientClaudeCode',
  claudeDesktop: 'mcpClientClaudeDesktop',
  codex: 'mcpClientCodex',
  copilotVsCode: 'mcpClientCopilotVsCode',
  copilotCli: 'mcpClientCopilotCli',
  json: 'mcpClientJson',
} as const satisfies Record<McpClientKind, string>

const { getText } = useText()
const toasts = useToasts()
const modals = useModals()

const status = ref<McpStatus>({
  enabled: false,
  port: MCP_DEFAULT_PORT,
  running: false,
  error: null,
  lockedByEnvironment: false,
})
/** `null` until main has answered. */
const claudeDesktop = ref<ClaudeDesktopStatus | null>(null)
const locked = computed(() => status.value.lockedByEnvironment)
const address = computed(() => `http://127.0.0.1:${status.value.port}/mcp`)
/** Claude Desktop's JSON is offered in its own block, beside where the file is. */
const COPY_ROW_CLIENTS = MCP_CLIENT_KINDS.filter((client) => client !== 'claudeDesktop')

/** Show a failure as a toast. */
function showError(error: unknown) {
  toasts.show(getMessageOrToString(error), { type: 'error' })
}

/** Read where Claude Desktop's configuration stands: its entry holds the address and token. */
function refreshClaudeDesktop() {
  window.api?.mcp?.claudeDesktopStatus().then((next) => {
    claudeDesktop.value = next
  }, showError)
}

onMounted(() => {
  const mcp = window.api?.mcp
  if (mcp == null) return
  const stopListening = mcp.onStatusChanged((next) => {
    status.value = next
    refreshClaudeDesktop()
  })
  refreshClaudeDesktop()
  onScopeDispose(stopListening)
  mcp.status().then((next) => {
    status.value = next
  }, showError)
})

/**
 * Bumped when a change fails, or resolves with a status other than the one asked for, so that the
 * switch and the port field go back to the server's state.
 */
const formResets = ref(0)

const setEnabled = useMutation({
  mutationFn: async (enabled: boolean) => {
    const next = await window.api?.mcp?.setEnabled(enabled)
    if (next == null) return
    status.value = next
    if (next.enabled !== enabled) formResets.value += 1
  },
  onError: (error) => {
    formResets.value += 1
    showError(error)
  },
})

/** A failure rejects into the port form, which shows it (`FormError`); there is no toast. */
const setPort = useMutation({
  mutationFn: async (port: number) => {
    const next = await window.api?.mcp?.setPort(port)
    if (next == null) return
    status.value = next
    if (next.port !== port) formResets.value += 1
  },
})

const copyConfig = useMutation({
  mutationFn: async (client: McpClientKind) => {
    await window.api?.mcp?.copyConfig(client)
    toasts.show(getText('copied'), { type: 'success' })
  },
  onError: showError,
})

const replaceToken = useMutation({
  mutationFn: async () => {
    const next = await window.api?.mcp?.replaceToken()
    if (next != null) status.value = next
    toasts.show(getText('mcpTokenReplaced'), { type: 'success' })
  },
  onError: showError,
})

const setUpClaudeDesktop = useMutation({
  mutationFn: async () => {
    const next = await window.api?.mcp?.setUpClaudeDesktop()
    if (next == null) return
    claudeDesktop.value = next
    // Only an entry now in place is done; otherwise the block shows the state the file is in (for
    // `unreadable`, why), as it does on mount.
    if (next.state === 'setUp') toasts.show(getText('mcpClaudeDesktopDone'), { type: 'success' })
  },
  onError: showError,
})

async function askSetUpClaudeDesktop() {
  const updating = claudeDesktop.value?.state === 'outOfDate'
  const label = getText(updating ? 'mcpClaudeDesktopUpdateButton' : 'mcpClaudeDesktopSetUpButton')
  const answer = await modals.ask(McpClaudeDesktopConfirmModal, {
    title: label,
    message: getText(updating ? 'mcpClaudeDesktopUpdateConfirm' : 'mcpClaudeDesktopConfirm'),
    confirm: label,
  })
  if (answer === 'confirm') setUpClaudeDesktop.mutate()
}

async function askReplaceToken() {
  const answer = await modals.ask(ConfirmDeleteModal, {
    alert: getText('mcpNewTokenWarning'),
    actionText: getText('mcpNewTokenActionText'),
    actionButtonLabel: getText('mcpNewToken'),
  })
  if (answer === 'confirm') replaceToken.mutate()
}
</script>

<template>
  <div class="flex flex-col gap-2" data-testid="mcp-settings-section">
    <Form
      :key="`${status.enabled}-${formResets}`"
      :schema="(z) => z.object({ enabled: z.boolean() })"
      :defaultValues="{ enabled: status.enabled }"
      @change="(name, value) => name === 'enabled' && setEnabled.mutate(value === true)"
    >
      <Switch name="enabled" :label="getText('mcpEnabledSetting')" :isDisabled="locked" />
    </Form>
    <Text v-if="locked" testId="mcp-locked">{{ getText('mcpLockedByEnvironment') }}</Text>
    <Alert v-if="status.error != null" variant="error">
      <Text testId="mcp-error">{{ status.error }}</Text>
    </Alert>
    <Text>{{ getText('mcpWarning') }}</Text>
    <template v-if="status.enabled">
      <div class="flex flex-col gap-1">
        <Text weight="bold">{{ getText('mcpAddressLabel') }}</Text>
        <Text textSelection="all" monospace testId="mcp-address">{{ address }}</Text>
      </div>
      <Form
        :key="`${status.port}-${formResets}`"
        :schema="
          (z) =>
            z.object({
              port: z
                .number({ message: getText('mcpPortInvalid') })
                .int(getText('mcpPortInvalid'))
                .min(MIN_PORT, getText('mcpPortInvalid'))
                .max(MAX_PORT, getText('mcpPortInvalid')),
            })
        "
        :defaultValues="{ port: status.port }"
        @submit="({ port }) => setPort.mutateAsync(port)"
      >
        <Input name="port" type="number" :label="getText('mcpPortLabel')" :isDisabled="locked" />
        <ButtonGroup class="grow-0">
          <!-- `undefined` when unlocked, so that the button keeps its own disabled-while-submitting. -->
          <Submit size="small" variant="outline" :isDisabled="locked || undefined">
            {{ getText('save') }}
          </Submit>
        </ButtonGroup>
        <FormError />
      </Form>
      <div class="flex flex-col gap-1">
        <Text weight="bold">{{ getText('mcpCopySetupFor') }}</Text>
        <ButtonGroup class="grow-0 flex-wrap">
          <Button
            v-for="client in COPY_ROW_CLIENTS"
            :key="client"
            size="small"
            variant="outline"
            @press="copyConfig.mutate(client)"
          >
            {{ getText(CLIENT_LABEL_IDS[client]) }}
          </Button>
        </ButtonGroup>
      </div>
      <div
        v-if="claudeDesktop != null"
        class="flex flex-col gap-1"
        data-testid="mcp-claude-desktop"
      >
        <Text weight="bold">{{ getText('mcpClaudeDesktopHeading') }}</Text>
        <Text v-if="claudeDesktop.state === 'notInstalled'">
          {{ getText('mcpClaudeDesktopNotInstalled') }}
        </Text>
        <Text v-else-if="claudeDesktop.state === 'setUp'">
          {{ getText('mcpClaudeDesktopIsSetUp') }}
        </Text>
        <Text v-else-if="claudeDesktop.state === 'outOfDate'">
          {{ getText('mcpClaudeDesktopOutOfDate') }}
        </Text>
        <template v-else-if="claudeDesktop.state === 'unreadable'">
          <Text>{{ claudeDesktop.reason }}</Text>
          <Text>{{ getText('mcpClaudeDesktopUnreadableHint') }}</Text>
        </template>
        <ButtonGroup
          v-if="claudeDesktop.state === 'notSetUp' || claudeDesktop.state === 'outOfDate'"
          class="grow-0"
        >
          <Button size="small" variant="outline" @press="askSetUpClaudeDesktop">
            {{
              getText(
                claudeDesktop.state === 'outOfDate' ?
                  'mcpClaudeDesktopUpdateButton'
                : 'mcpClaudeDesktopSetUpButton',
              )
            }}
          </Button>
        </ButtonGroup>
        <template v-if="claudeDesktop.configFile != null">
          <Text>{{ getText('mcpClaudeDesktopManualIntro') }}</Text>
          <Text textSelection="all" monospace testId="mcp-claude-desktop-config-file">
            {{ claudeDesktop.configFile }}
          </Text>
          <Text>{{ getText('mcpClaudeDesktopManualSteps') }}</Text>
          <ButtonGroup class="grow-0">
            <Button size="small" variant="outline" @press="copyConfig.mutate('claudeDesktop')">
              {{ getText('mcpClaudeDesktopCopyJson') }}
            </Button>
          </ButtonGroup>
        </template>
        <Text>{{ getText('mcpClaudeDesktopNeeds') }}</Text>
      </div>
      <ButtonGroup class="grow-0">
        <Button size="small" variant="outline" @press="askReplaceToken">
          {{ getText('mcpNewToken') }}
        </Button>
      </ButtonGroup>
    </template>
  </div>
</template>
