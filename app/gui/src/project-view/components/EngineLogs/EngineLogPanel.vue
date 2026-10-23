<script setup lang="ts">
/**
 * @file The Logs tab of the bottom dock: the open project's engine log as it is written, with its
 * earlier lines and sessions (`docs/superpowers/specs/2026-10-20-engine-logs-panel-design.md`).
 */
import { useBackends } from '$/providers/backends'
import { useText } from '$/providers/text'
import { useQuery } from '@tanstack/vue-query'
import {
  ProjectSessionId,
  type ProjectId,
  type ProjectSession,
} from 'enso-common/src/services/Backend'
import type { LocalBackend } from 'enso-common/src/services/LocalBackend'
import { toReadableIsoString } from 'enso-common/src/utilities/data/dateTime'
import { computed, ref, shallowRef, toValue, watch } from 'vue'
import EngineLogList from './EngineLogList.vue'
import { fetchSessionLines } from './engineLogHistory'
import {
  filterRows,
  rowsFromLines,
  type LevelFilter,
  type LogRow,
  type OriginFilter,
} from './engineLogModel'
import type { EngineLogStream } from './engineLogStream'

const { stream, projectId } = defineProps<{
  stream: EngineLogStream
  projectId: ProjectId
}>()

const { getText } = useText()
const backends = useBackends()
const systemApi = window.api?.system

const level = ref<LevelFilter>('info')
const origin = ref<OriginFilter>('all')
const filterText = ref('')
const follow = ref(true)
/** The earlier session shown, read-only; `''` for the live one. */
const selectedSession = ref('')
const sessionRows = shallowRef<readonly LogRow[]>([])
const loading = ref(false)
const loadError = ref<string>()

const live = computed(() => selectedSession.value === '')

const sessions = useQuery({
  queryKey: computed(() => ['engineLogSessions', projectId, stream.state.sessionId]),
  queryFn: async (): Promise<readonly ProjectSession[]> =>
    (await backends.localBackend?.listProjectSessions(projectId)) ?? [],
})

/** The earlier sessions, newest first, numbered from the oldest as the Activity tab numbers them. */
const earlierSessions = computed(() =>
  (sessions.data.value ?? [])
    .map((session, index) => ({ session, number: index + 1 }))
    .filter(({ session }) => session.projectSessionId !== stream.state.sessionId)
    .reverse(),
)

// `toValue`: a test harness may hand the stream over reactive, which unwraps `rows`.
const shownRows = computed(() =>
  filterRows(live.value ? toValue(stream.rows) : sessionRows.value, {
    level: level.value,
    text: filterText.value,
    origin: origin.value,
  }),
)

/** The latest history or session request; only it may set `loading` and `loadError`. */
let latestRequest = 0

async function withBackend(task: (backend: LocalBackend) => Promise<void>) {
  const backend = backends.localBackend
  if (backend == null) return
  const request = ++latestRequest
  loading.value = true
  loadError.value = undefined
  try {
    await task(backend)
  } catch (error) {
    if (request === latestRequest) {
      loadError.value = error instanceof Error ? error.message : String(error)
    }
  } finally {
    if (request === latestRequest) loading.value = false
  }
}

watch(selectedSession, (sessionId) => {
  sessionRows.value = []
  follow.value = true
  // A request still running belongs to the view being left: it no longer sets the notices.
  latestRequest += 1
  loading.value = false
  loadError.value = undefined
  if (sessionId === '') return
  void withBackend(async (backend) => {
    const lines = await fetchSessionLines(backend, ProjectSessionId(sessionId))
    if (selectedSession.value === sessionId) sessionRows.value = rowsFromLines(lines)
  })
})

/** At the top of the live view: load the current session's earlier lines, if it has any. */
function onReachedTop() {
  const sessionId = stream.state.sessionId
  if (!live.value || loading.value || stream.state.sessionStartHeld || sessionId == null) return
  const request = { project: projectId, sessionId }
  void withBackend(async (backend) => {
    // `loadHistory` drops the lines if the project or the session changed while they were fetched.
    stream.loadHistory(await fetchSessionLines(backend, ProjectSessionId(sessionId)), request)
  })
}

function showInFolder() {
  const file = stream.state.logFile
  if (file != null) systemApi?.showItemInFolder(file)
}

function sessionLabel(session: ProjectSession, number: number) {
  return `${getText('projectSessionX', number)} (${toReadableIsoString(new Date(session.createdAt))})`
}
</script>

<template>
  <div class="EngineLogPanel" data-testid="engine-log-panel">
    <div class="toolbar">
      <select v-model="level" :aria-label="getText('engineLogsLevel')">
        <option value="error">{{ getText('engineLogsLevelError') }}</option>
        <option value="warn">{{ getText('engineLogsLevelWarn') }}</option>
        <option value="info">{{ getText('engineLogsLevelInfo') }}</option>
      </select>
      <select v-model="origin" :aria-label="getText('engineLogsOrigin')">
        <option value="all">{{ getText('engineLogsOriginAll') }}</option>
        <option value="library">{{ getText('engineLogsOriginLibraries') }}</option>
        <option value="engine">{{ getText('engineLogsOriginEngine') }}</option>
      </select>
      <input
        v-model="filterText"
        type="search"
        :aria-label="getText('engineLogsFilter')"
        :placeholder="getText('engineLogsFilter')"
      />
      <select v-model="selectedSession" :aria-label="getText('engineLogsSession')">
        <option value="">{{ getText('engineLogsThisSession') }}</option>
        <option
          v-for="{ session, number } in earlierSessions"
          :key="session.projectSessionId"
          :value="session.projectSessionId"
        >
          {{ sessionLabel(session, number) }}
        </option>
      </select>
      <span class="spacer" />
      <button
        v-if="systemApi != null && stream.state.logFile != null"
        type="button"
        @click="showInFolder"
      >
        {{ getText('engineLogsShowInFolder') }}
      </button>
    </div>
    <div v-if="loading" class="notice" role="status">
      {{ getText('engineLogsLoadingHistory') }}
    </div>
    <div v-if="loadError != null" class="notice error" role="alert">
      {{ getText('engineLogsHistoryFailed', loadError) }}
    </div>
    <EngineLogList
      v-model:follow="follow"
      class="list"
      :rows="shownRows"
      @reachedTop="onReachedTop"
    />
    <div v-if="live && stream.state.waiting" class="notice" role="status">
      {{ getText('engineLogsWaiting') }}
    </div>
    <div v-else-if="live && stream.state.ended != null" class="notice" role="status">
      {{ getText('engineLogsEnded') }}
    </div>
    <button v-if="live && !follow" type="button" class="jump" @click="follow = true">
      {{ getText('engineLogsJumpToLatest') }}
    </button>
  </div>
</template>

<style scoped>
.EngineLogPanel {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  backdrop-filter: var(--blur-app-bg);
  background-color: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.4);
  color: var(--color-text);
}

.toolbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  font-size: 12px;
}

.toolbar select,
.toolbar input,
.toolbar button {
  height: 22px;
  padding: 0 6px;
  border-radius: 6px;
  border: 1px solid var(--color-dim);
  background-color: white;
  font: inherit;
}

.toolbar input {
  width: 16em;
}

.spacer {
  flex: 1;
}

.list {
  flex: 1;
  min-height: 0;
}

.notice {
  flex: none;
  padding: 2px 8px;
  font-size: 12px;
  opacity: 0.7;
}

.notice.error {
  color: var(--color-error);
  opacity: 1;
}

.jump {
  position: absolute;
  right: 16px;
  bottom: 16px;
  padding: 2px 10px;
  border-radius: 12px;
  border: none;
  background-color: var(--color-text);
  color: var(--color-text-inversed);
  font-size: 12px;
}
</style>
