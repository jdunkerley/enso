<script setup lang="ts">
/**
 * @file The MCP activity icon at the right end of the top bar, and its view-only popover (#864):
 * whether MCP is off, has a problem, is on with no agent app seen lately, or has one connected or
 * working, with the connected app, its last few calls and, while it is off, an Enable button that
 * does what the Settings switch does. It controls nothing else about the agent.
 *
 * It renders only in the desktop app (`window.api.mcp`). It is its own element in
 * `AppContainer.vue`, not a child of the tab bar, so that it stays on the Drive with no tab open.
 * A call line shows only the tool's name, its outcome and its age: main never sends more.
 */
import Alert from '$/components/Alert/Alert.vue'
import Button from '$/components/Button/Button.vue'
import Popover from '$/components/Dialog/Popover.vue'
import Icon from '$/components/Icon/Icon.vue'
import Text from '$/components/Text/Text.vue'
import { SEARCH_PARAMS_PREFIX } from '$/appUtils'
import SettingsTabType from '$/configurations/settingsTabs'
import { useText } from '$/providers/text'
import {
  MCP_DEFAULT_PORT,
  type McpActivityCall,
  type McpActivitySnapshot,
  type McpStatus,
} from 'enso-common/src/mcp'
import { getMessageOrToString } from 'enso-common/src/utilities/errors'
import { computed, onMounted, onScopeDispose, ref, watch, watchEffect } from 'vue'
import { useRouter } from 'vue-router'
import { connectedClients, mcpActivityState, relativeAgo } from './mcpActivityState'

/** At most this many clients get a line of their own. */
const MAX_CLIENT_LINES = 3

const mcp = window.api?.mcp
const router = useRouter()
const { getText, locale } = useText()

const status = ref<McpStatus>({
  enabled: false,
  port: MCP_DEFAULT_PORT,
  running: false,
  error: null,
  lockedByEnvironment: false,
})
const activity = ref<McpActivitySnapshot>({ clients: [], calls: [] })
const open = ref(false)
/** The window's clock, refreshed on every change and once a second while the time matters. */
const now = ref(Date.now())
const enabling = ref(false)
const enableError = ref<string | null>(null)

onMounted(() => {
  if (mcp == null) return
  onScopeDispose(
    mcp.onStatusChanged((next) => {
      status.value = next
    }),
  )
  onScopeDispose(
    mcp.onActivityChanged((next) => {
      activity.value = next
    }),
  )
  void mcp.status().then((next) => (status.value = next), console.error)
  void mcp.activity().then((next) => (activity.value = next), console.error)
})

watch([status, activity], () => (now.value = Date.now()))

const state = computed(() => mcpActivityState(status.value, activity.value, now.value))
const connected = computed(() => connectedClients(activity.value, now.value))
/** Whether the clock must run: the popover shows ages, and a state may lapse by time alone. */
const clockRuns = computed(
  () => open.value || state.value === 'active' || state.value === 'connected',
)
watchEffect((onCleanup) => {
  if (!clockRuns.value) return
  now.value = Date.now()
  const timer = setInterval(() => (now.value = Date.now()), 1000)
  onCleanup(() => clearInterval(timer))
})

/** The most recently seen client, connected or not. */
const lastClient = computed(() => activity.value.clients[0])
const address = computed(() => `http://127.0.0.1:${status.value.port}/mcp`)

const name = computed(() => {
  switch (state.value) {
    case 'off':
      return getText('mcpActivityNameOff')
    case 'error':
      return getText('mcpActivityNameProblem')
    case 'idle':
      return getText('mcpActivityNameIdle')
    case 'connected':
      return getText('mcpActivityNameConnected', connected.value[0]?.name ?? '')
    case 'active':
      return getText(
        'mcpActivityNameActive',
        connected.value[0]?.name ?? lastClient.value?.name ?? '',
      )
  }
})

const statusWord = computed(() =>
  state.value === 'off' ? getText('mcpActivityStateOff')
  : state.value === 'error' ? getText('mcpActivityStateProblem')
  : getText('mcpActivityStateOn'),
)

const ago = (time: number) => relativeAgo(time, now.value, locale, getText('mcpActivityJustNow'))
const shownClients = computed(() => connected.value.slice(0, MAX_CLIENT_LINES))
const hiddenClients = computed(() => connected.value.length - shownClients.value.length)
/** With several clients each call line names its client; with one it is said once above. */
const nameCalls = computed(() => connected.value.length > 1)
const showCalls = computed(
  () => state.value !== 'off' && state.value !== 'error' && activity.value.calls.length > 0,
)

function outcomeWord(call: McpActivityCall): string {
  switch (call.outcome) {
    case 'running':
      return getText('mcpActivityRunning')
    case 'ok':
      return getText('mcpActivityOk')
    case 'refused':
      return getText('mcpActivityRefused')
    case 'error':
      return getText('mcpActivityError')
  }
}

/** How long a finished call took, in seconds with a decimal. */
function duration(call: McpActivityCall): string | null {
  return call.endedAt == null ? null : `${((call.endedAt - call.startedAt) / 1000).toFixed(1)} s`
}

/** When a call is dated: when it ended, or began while it still runs. */
const callTime = (call: McpActivityCall) => call.endedAt ?? call.startedAt

/** The call line's spoken form: "get_graph, OK, 12 seconds ago". */
function callLabel(call: McpActivityCall): string {
  return getText('mcpActivityCallLabel', call.tool, outcomeWord(call), ago(callTime(call)))
}

/** The same as the Settings switch: main saves the setting, starts the server and broadcasts. */
async function enable() {
  if (mcp == null) return
  enabling.value = true
  enableError.value = null
  try {
    status.value = await mcp.setEnabled(true)
  } catch (error) {
    enableError.value = getMessageOrToString(error)
  } finally {
    enabling.value = false
  }
}

function openSettings() {
  open.value = false
  void router.push({
    path: '/settings',
    query: { [`${SEARCH_PARAMS_PREFIX}SettingsTab`]: JSON.stringify(SettingsTabType.ai) },
  })
}
</script>

<template>
  <Popover
    v-if="mcp != null"
    v-model:open="open"
    placement="bottom-end"
    size="auto"
    class="w-80"
    testId="mcp-activity-popover"
    aria-labelledby="mcp-activity-heading"
  >
    <template #trigger>
      <button
        type="button"
        class="McpActivityButton"
        :class="`state-${state}`"
        :aria-label="name"
        :title="name"
        data-testid="mcp-activity-button"
        :data-state-name="state"
      >
        <Icon icon="mcp_activity" :color="state === 'off' ? 'disabled' : 'primary'" />
        <span v-if="state !== 'off' && state !== 'idle'" class="badge" aria-hidden="true">
          <template v-if="state === 'error'">!</template>
        </span>
      </button>
    </template>
    <div class="flex flex-col gap-2" data-testid="mcp-activity-content">
      <div class="flex items-center justify-between gap-2">
        <Text id="mcp-activity-heading" weight="bold" elementType="h2">
          {{ getText('mcpActivityHeading') }}
        </Text>
        <Text :color="state === 'error' ? 'danger' : 'muted'" testId="mcp-activity-status-word">
          {{ statusWord }}
        </Text>
      </div>

      <template v-if="state === 'off'">
        <Text>{{ getText('mcpActivityOffText') }}</Text>
        <Text v-if="status.lockedByEnvironment" testId="mcp-activity-locked">
          {{ getText('mcpLockedByEnvironment') }}
        </Text>
        <Alert v-else variant="warning">{{ getText('mcpWarning') }}</Alert>
        <Button
          variant="accent"
          :isDisabled="status.lockedByEnvironment"
          :isLoading="enabling"
          testId="mcp-activity-enable"
          :onPress="enable"
        >
          {{ getText('mcpActivityEnable') }}
        </Button>
        <Text v-if="enableError != null" color="danger" testId="mcp-activity-enable-error">
          {{ enableError }}
        </Text>
      </template>

      <template v-else-if="state === 'error'">
        <Text color="danger" testId="mcp-activity-error">{{ status.error }}</Text>
      </template>

      <template v-else>
        <Text monospace textSelection="all">{{ address }}</Text>
        <Text v-if="lastClient == null" testId="mcp-activity-no-client">
          {{ getText('mcpActivityNoClient') }}
        </Text>
        <Text v-else-if="connected.length === 0" testId="mcp-activity-last-seen">
          {{ getText('mcpActivityLastSeen', lastClient.name, ago(lastClient.lastSeenAt)) }}
        </Text>
        <ul v-else class="flex flex-col gap-0.5" data-testid="mcp-activity-clients">
          <li
            v-for="client in shownClients"
            :key="client.name"
            class="flex items-baseline justify-between gap-2"
          >
            <Text weight="semibold" truncate="1">
              {{ client.version != null ? `${client.name} ${client.version}` : client.name }}
            </Text>
            <Text color="muted" nowrap>
              {{ getText('mcpActivitySeen', ago(client.lastSeenAt)) }}
            </Text>
          </li>
          <li v-if="hiddenClients > 0">
            <Text color="muted">{{ getText('mcpActivityAndMore', hiddenClients) }}</Text>
          </li>
        </ul>

        <template v-if="showCalls">
          <Text weight="bold">{{ getText('mcpActivityRecentCalls') }}</Text>
          <ul class="flex flex-col gap-0.5" data-testid="mcp-activity-calls">
            <li
              v-for="call in activity.calls"
              :key="call.id"
              class="flex items-baseline gap-2"
              :aria-label="callLabel(call)"
              :data-outcome="call.outcome"
            >
              <span class="outcomeGlyph" aria-hidden="true">
                {{
                  call.outcome === 'running' ? '◌'
                  : call.outcome === 'ok' ? '✓'
                  : call.outcome === 'refused' ? '⊘'
                  : '✕'
                }}
              </span>
              <Text monospace truncate="1" class="min-w-0 flex-1">
                {{ nameCalls ? `${call.client} · ${call.tool}` : call.tool }}
              </Text>
              <Text
                v-if="call.outcome === 'refused' || call.outcome === 'error'"
                :color="call.outcome === 'error' ? 'danger' : 'muted'"
                nowrap
              >
                {{ outcomeWord(call) }}
              </Text>
              <Text v-else-if="call.outcome === 'running'" color="muted" nowrap>
                {{ outcomeWord(call) }}
              </Text>
              <Text v-else color="muted" nowrap>{{ duration(call) }}</Text>
              <Text v-if="call.outcome !== 'running'" color="muted" nowrap>
                {{ ago(callTime(call)) }}
              </Text>
            </li>
          </ul>
        </template>
      </template>

      <Button
        variant="link"
        icon="chevron_right"
        testId="mcp-activity-settings"
        @press="openSettings"
      >
        {{ getText('mcpActivitySettingsLink') }}
      </Button>
    </div>
  </Popover>
</template>

<style scoped>
.McpActivityButton {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  &:hover,
  &:focus-visible {
    background-color: var(--color-dashboard-background);
  }
}

/* The state's dot: 6px at the glyph's bottom right, ringed in the bar's colour. */
.badge {
  position: absolute;
  right: 4px;
  bottom: 4px;
  box-sizing: content-box;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  border: 1px solid var(--color-dashboard-background, #fff);
  background-color: #2e9d57;
  color: white;
  font-size: 6px;
  line-height: 6px;
  font-weight: 700;
  text-align: center;
}

.state-error .badge {
  background-color: #d93636;
}

@media (prefers-reduced-motion: no-preference) {
  .state-active .badge {
    animation: mcp-activity-pulse 1.2s ease-in-out infinite;
  }
}

@keyframes mcp-activity-pulse {
  50% {
    transform: scale(1.5);
    opacity: 0.6;
  }
}

.outcomeGlyph {
  width: 1em;
  flex: none;
  text-align: center;
}
</style>
