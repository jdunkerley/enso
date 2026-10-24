<script setup lang="ts">
/**
 * @file An engine log viewer: the Logs tab of the bottom dock (the open project's log as it is
 * written, with its earlier lines and sessions), and the app's session log tab, opened from
 * Activity → Show Logs, which shows a session read-only without a live stream
 * (`docs/superpowers/specs/2026-10-20-engine-logs-panel-design.md`).
 */
import SvgIcon from '@/components/SvgIcon.vue'
import Popover from '$/components/Dialog/Popover.vue'
import { useBackends } from '$/providers/backends'
import { useEngineLogSettings } from '$/providers/engineLogSettings'
import { useText } from '$/providers/text'
import { useQuery } from '@tanstack/vue-query'
import {
  ProjectSessionId,
  type ProjectId,
  type ProjectSession,
} from 'enso-common/src/services/Backend'
import type { LocalBackend } from 'enso-common/src/services/LocalBackend'
import { toReadableIsoString } from 'enso-common/src/utilities/data/dateTime'
import * as detect from 'enso-common/src/utilities/detect'
import { computed, ref, shallowRef, toValue, useId, watch } from 'vue'
import EngineLogList from './EngineLogList.vue'
import {
  DEFAULT_ORIGINS,
  filterRows,
  LIVE_ROW_CAP,
  loggerSuggestions,
  originSummary,
  rowsFromLines,
  type LevelFilter,
  type LogOrigin,
  type LogRow,
} from './engineLogModel'
import type { EngineLogStream } from './engineLogStream'
import { fetchNewestSessionLines, SessionLogWindow } from './sessionLogWindow'

const { stream, projectId, initialSession } = defineProps<{
  /** The open project's live log; without it the panel shows sessions read from their files. */
  stream?: EngineLogStream | undefined
  /** The project whose sessions the session picker lists. */
  projectId?: ProjectId | undefined
  /** The session shown first, when there is no live stream. */
  initialSession?: string | undefined
}>()

const { getText } = useText()
const backends = useBackends()
const systemApi = window.api?.system
const loggerListId = useId()

const engineLogSettings = useEngineLogSettings()

const level = ref<LevelFilter>('all')
/** Which origins show; the engine's internals are hidden at first. */
const origins = ref<Record<LogOrigin, boolean>>({ ...DEFAULT_ORIGINS })
/**
 * The origin tickboxes, in toolbar order. SQL queries and Performance show only while their setting
 * (Settings → Local → Engine logs) is on.
 */
const originBoxes = computed(() =>
  (
    [
      { origin: 'engine', label: 'engineLogsOriginEngine', shown: true },
      { origin: 'library', label: 'engineLogsOriginLibraries', shown: true },
      { origin: 'user', label: 'engineLogsOriginUser', shown: true },
      {
        origin: 'sql',
        label: 'engineLogsOriginSql',
        shown: engineLogSettings.value.sqlQueries,
      },
      {
        origin: 'performance',
        label: 'engineLogsOriginPerformance',
        shown: engineLogSettings.value.performanceTimings,
      },
    ] as const
  ).filter((box) => box.shown),
)
/** The Sources button's label: which of the boxes shown are ticked. */
const sourcesLabel = computed(() => {
  const boxes = originBoxes.value
  const summary = originSummary(
    boxes.map((box) => box.origin),
    origins.value,
  )
  switch (summary.kind) {
    case 'all':
      return getText('engineLogsOriginAll')
    case 'none':
      return getText('engineLogsOriginNone')
    case 'one': {
      const box = boxes.find((box) => box.origin === summary.origin)!
      return getText('engineLogsOriginOne', getText(box.label))
    }
    case 'some':
      return getText('engineLogsOriginSome', summary.ticked, summary.shown)
  }
})
/** The Sources button's tooltip: the ticked boxes by name. */
const sourcesTitle = computed(() =>
  originBoxes.value
    .filter((box) => origins.value[box.origin])
    .map((box) => getText(box.label))
    .join(', '),
)
/**
 * Whether the Sources popover is open. It opens from its button, and as the text filter takes
 * focus; it closes on Escape or a press outside it, but not on the text filter, nor as a box is
 * ticked.
 */
const sourcesOpen = ref(false)
/** Whether the popover was opened by the text filter, which then keeps the focus (`keepFocus`). */
const sourcesOpenedByFilter = ref(false)
const filterInput = ref<HTMLInputElement>()

function openSourcesFromFilter() {
  if (sourcesOpen.value) return
  sourcesOpenedByFilter.value = true
  sourcesOpen.value = true
}

watch(sourcesOpen, (open) => {
  if (!open) sourcesOpenedByFilter.value = false
})

/**
 * Escape closes the Sources popover, from the text filter or from inside it. Handled here, before
 * the event reaches the window: the graph's Escape (`app.cancel`) would otherwise take it first, and
 * Reka's own Escape listener never see it. Only that: the first Escape does not also clear the
 * filter or reach the graph.
 */
function closeSourcesOnEscape(event: KeyboardEvent) {
  if (!sourcesOpen.value) return
  event.stopPropagation()
  event.preventDefault()
  sourcesOpen.value = false
}

/** A press on, or focus moving to, the text filter leaves the Sources popover open. */
function keepSourcesOpenForFilter(event: CustomEvent<{ originalEvent: Event }>) {
  const target = event.detail.originalEvent.target
  if (target instanceof Node && filterInput.value?.contains(target)) event.preventDefault()
}

/**
 * The origins the rows are filtered by. An origin without a tickbox is not filtered out: its lines
 * (from before its setting was turned off, or an earlier session's) stay in view rather than being
 * hidden by a box the user cannot see.
 */
const originFilter = computed(() => ({
  ...origins.value,
  sql: origins.value.sql || !engineLogSettings.value.sqlQueries,
  performance: origins.value.performance || !engineLogSettings.value.performanceTimings,
}))
// A box checked by default whenever it appears.
watch(
  () => engineLogSettings.value.sqlQueries,
  (on) => {
    if (on) origins.value.sql = true
  },
)
watch(
  () => engineLogSettings.value.performanceTimings,
  (on) => {
    if (on) origins.value.performance = true
  },
)
const filterText = ref('')
/** A dotted logger prefix: only the entries of loggers under it show. */
const loggerFilter = ref('')
const follow = ref(true)
/** The session picked; `''` for the live one (only with a live stream). */
const selectedSession = ref(stream != null ? '' : (initialSession ?? ''))
/**
 * The live session, when it is shown from its file, paged back from the live view; fixed when
 * paging back starts, so a restart meanwhile does not move the view to the new session.
 */
const liveSnapshotSession = ref<string | null>(null)
const liveSnapshot = computed(() => liveSnapshotSession.value != null)
/** Whether the next session opened from its file starts one step back from its newest lines. */
let pageBackOnOpen = false
const loading = ref(false)
const loadError = ref<string>()

const live = computed(() => stream != null && selectedSession.value === '' && !liveSnapshot.value)

const sessions = useQuery({
  queryKey: computed(() => ['engineLogSessions', projectId, stream?.state.sessionId]),
  queryFn: async (): Promise<readonly ProjectSession[]> =>
    projectId == null ? [] : ((await backends.localBackend?.listProjectSessions(projectId)) ?? []),
})

/** A session the picker offers; `session` is missing for one asked for but not listed. */
interface PickableSession {
  readonly id: string
  readonly number: number
  readonly session: ProjectSession | undefined
}

/**
 * The sessions the picker offers besides the live one, newest first, numbered from the oldest as
 * the Activity tab numbers them. Without a live stream, the session asked for is always among them.
 */
const pickableSessions = computed<readonly PickableSession[]>(() => {
  const listed: PickableSession[] = (sessions.data.value ?? [])
    .map((session, index) => ({ id: String(session.projectSessionId), number: index + 1, session }))
    .filter(({ id }) => stream == null || id !== stream.state.sessionId)
    .reverse()
  const initial = initialSession
  if (stream == null && initial != null && !listed.some(({ id }) => id === initial)) {
    listed.unshift({ id: initial, number: 0, session: undefined })
  }
  return listed
})

/** The session read from its files, if any: an earlier one picked, or the live one paged back. */
const windowSessionId = computed(() =>
  selectedSession.value !== '' ? selectedSession.value : liveSnapshotSession.value,
)
const logWindow = shallowRef<SessionLogWindow>()
const windowRows = shallowRef<readonly LogRow[]>([])
/** Whether the session shown from its files has none (it was deleted, or is unknown). */
const windowHasNoFiles = ref(false)

/**
 * The live rows, under a `truncated` divider while there are lines above them (`olderLines`, bound
 * to their session: its button pages through that session, and is not offered while it is unknown).
 */
const liveRows = computed<readonly LogRow[]>(() => {
  if (stream == null) return []
  // `toValue`: a test harness may hand the stream over reactive, which unwraps `rows`.
  const rows = toValue(stream.rows)
  const older = stream.state.olderLines
  if (older == null) return rows
  const divider: LogRow = {
    kind: 'divider',
    key: Number.MIN_SAFE_INTEGER,
    divider: 'truncated',
    sessionId: older.sessionId,
  }
  return [divider, ...rows]
})

/** The rows of the view, before the filters. */
const sourceRows = computed<readonly LogRow[]>(() =>
  live.value ? liveRows.value : windowRows.value,
)

const shownRows = computed(() =>
  filterRows(sourceRows.value, {
    level: level.value,
    text: filterText.value,
    origins: originFilter.value,
    logger: loggerFilter.value,
  }),
)

const loggerOptions = computed(() => loggerSuggestions(sourceRows.value))

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

/** Show the window's lines; their keys follow the window, so the list keeps its place. */
function showWindow(window: SessionLogWindow) {
  if (logWindow.value !== window) return
  windowRows.value = rowsFromLines(window.lines, {
    older: window.hasOlder,
    newer: window.hasNewer,
    firstKey: window.firstLine,
    sessionId: window.sessionId,
    leadingEntry: window.leadingEntry,
  })
  windowHasNoFiles.value = window.noFiles
}

/** Run `move` on the window shown, and show its lines if it is still the one shown. */
function moveWindow(move: (window: SessionLogWindow) => Promise<void>) {
  const window = logWindow.value
  if (window == null || loading.value) return
  void withBackend(async () => {
    await move(window)
    showWindow(window)
  })
}

watch(
  windowSessionId,
  (sessionId) => {
    windowRows.value = []
    windowHasNoFiles.value = false
    follow.value = true
    // A request still running belongs to the view being left: it no longer sets the notices.
    latestRequest += 1
    loading.value = false
    loadError.value = undefined
    const backend = backends.localBackend
    if (sessionId == null || backend == null) {
      logWindow.value = undefined
      return
    }
    // Opened from a Load older lines in the live view: one step past its newest lines.
    const pagedBack = pageBackOnOpen
    pageBackOnOpen = false
    logWindow.value = new SessionLogWindow(backend, ProjectSessionId(sessionId))
    if (pagedBack) follow.value = false
    moveWindow(async (window) => {
      await window.latest()
      if (pagedBack) await window.older()
    })
  },
  { immediate: true },
)

/**
 * A divider's Load older lines for `sessionId`: in a window, page it back; in the live view, open
 * that session's file one step back: the live session in place (with Back to live), an earlier one
 * (whose lines are still in view after a restart) as if it had been picked.
 */
function loadOlder(sessionId: string) {
  if (!live.value) {
    follow.value = false
    moveWindow((window) => window.older())
    return
  }
  pageBackOnOpen = true
  if (sessionId === stream?.state.sessionId) liveSnapshotSession.value = sessionId
  else selectedSession.value = sessionId
}

function loadNewer() {
  follow.value = false
  moveWindow((window) => window.newer())
}

/** Read the shown session's file again (not offered live: the live view is already current). */
function reload() {
  follow.value = true
  moveWindow((window) => window.latest())
}

function backToLive() {
  follow.value = true
  liveSnapshotSession.value = null
  selectedSession.value = ''
}

watch(selectedSession, () => {
  liveSnapshotSession.value = null
})

/** At the top of the live view: load the current session's earlier lines, if it has any. */
function onReachedTop() {
  if (stream == null || !live.value || loading.value || !stream.state.canLoadHistory) return
  const sessionId = stream.state.sessionId
  if (sessionId == null) return
  const request = { project: projectId ?? '', sessionId }
  // Never more than the view can hold: the rows it has, and a full view's worth above them.
  const wanted = LIVE_ROW_CAP + toValue(stream.rows).length
  void withBackend(async (backend) => {
    const newest = await fetchNewestSessionLines(backend, ProjectSessionId(sessionId), wanted)
    // `loadHistory` drops the lines if the project or the session changed while they were fetched.
    stream.loadHistory(newest.lines, request, newest.hasOlder)
  })
}

/** The session shown and its log file; either is `null` while there is none. */
const shownSession = computed(() => {
  if (stream != null && selectedSession.value === '') {
    return { id: stream.state.sessionId, logFile: stream.state.logFile }
  }
  const session = sessions.data.value?.find((s) => s.projectSessionId === selectedSession.value)
  return { id: selectedSession.value || null, logFile: session?.logFile ?? null }
})

/** The reveal button's name, as each OS calls its file manager. */
const revealLabel = getText(
  detect.isOnWindows() ? 'engineLogsRevealInExplorer'
  : detect.isOnMacOS() ? 'engineLogsShowInFinder'
  : 'engineLogsShowInFolder',
)

/** Why the last download failed; `undefined` unless it did, or once another session shows. */
const downloadError = ref<string>()
watch(
  () => shownSession.value.id,
  () => (downloadError.value = undefined),
)

/** Downloading needs a session and the local backend, which reads its files. */
const canDownload = computed(() => shownSession.value.id != null && backends.localBackend != null)

async function downloadLogFile() {
  const id = shownSession.value.id
  const backend = backends.localBackend
  if (id == null || backend == null) return
  downloadError.value = undefined
  try {
    await backend.downloadProjectSessionLogs(ProjectSessionId(id))
  } catch (error) {
    downloadError.value = error instanceof Error ? error.message : String(error)
  }
}

function revealLogFile() {
  const file = shownSession.value.logFile
  if (file != null) systemApi?.showLogFileInFolder(file)
}

function sessionLabel({ id, number, session }: PickableSession) {
  if (session == null) return getText('engineLogsSessionUnlisted', id.split('/').pop() ?? id)
  return `${getText('projectSessionX', number)} (${toReadableIsoString(new Date(session.createdAt))})`
}
</script>

<template>
  <div class="EngineLogPanel" data-testid="engine-log-panel">
    <div class="toolbar">
      <select v-model="level" :aria-label="getText('engineLogsLevel')">
        <option value="error">{{ getText('engineLogsLevelError') }}</option>
        <option value="warn">{{ getText('engineLogsLevelWarn') }}</option>
        <option value="all">{{ getText('engineLogsLevelAll') }}</option>
      </select>
      <input
        v-model="loggerFilter"
        type="search"
        class="loggerFilter"
        :list="loggerListId"
        :aria-label="getText('engineLogsLogger')"
        :placeholder="getText('engineLogsLogger')"
      />
      <datalist :id="loggerListId">
        <option v-for="name in loggerOptions" :key="name" :value="name" />
      </datalist>
      <input
        ref="filterInput"
        v-model="filterText"
        type="search"
        :aria-label="getText('engineLogsFilter')"
        :placeholder="getText('engineLogsFilter')"
        @focus="openSourcesFromFilter"
        @keydown.escape="closeSourcesOnEscape"
      />
      <Popover
        v-model:open="sourcesOpen"
        isNonModal
        :keepFocus="sourcesOpenedByFilter"
        placement="bottom-start"
        :offset="4"
        size="auto-xxsmall"
        rounded="large"
        testId="engine-logs-sources"
        :aria-label="getText('engineLogsOrigin')"
        @interactOutside="keepSourcesOpenForFilter"
        @keydown.escape="closeSourcesOnEscape"
      >
        <template #trigger>
          <button
            type="button"
            class="sourcesButton"
            :title="sourcesTitle"
            data-testid="engine-logs-sources-button"
          >
            <span class="sourcesLabel">{{ sourcesLabel }}</span>
            <SvgIcon name="arrow_right_head_only" class="sourcesArrow" />
          </button>
        </template>
        <fieldset class="origins" :aria-label="getText('engineLogsOrigin')">
          <label v-for="box in originBoxes" :key="box.origin" class="origin">
            <input v-model="origins[box.origin]" type="checkbox" :aria-label="getText(box.label)" />
            {{ getText(box.label) }}
          </label>
        </fieldset>
      </Popover>
      <select v-model="selectedSession" :aria-label="getText('engineLogsSession')">
        <option v-if="stream != null" value="">{{ getText('engineLogsThisSession') }}</option>
        <option v-for="option in pickableSessions" :key="option.id" :value="option.id">
          {{ sessionLabel(option) }}
        </option>
      </select>
      <span class="spacer" />
      <button
        v-if="!live"
        type="button"
        class="iconButton"
        :aria-label="getText('engineLogsReload')"
        :title="getText('engineLogsReload')"
        :disabled="logWindow == null || loading"
        data-testid="engine-logs-reload"
        @click="reload"
      >
        <SvgIcon name="refresh" />
      </button>
      <button
        type="button"
        class="iconButton"
        :aria-label="getText('engineLogsDownload')"
        :title="getText('engineLogsDownload')"
        :disabled="!canDownload"
        data-testid="engine-logs-download"
        @click="downloadLogFile"
      >
        <SvgIcon name="data_download" />
      </button>
      <button
        v-if="systemApi != null"
        type="button"
        class="iconButton"
        :aria-label="revealLabel"
        :title="revealLabel"
        :disabled="shownSession.logFile == null"
        data-testid="engine-logs-reveal"
        @click="revealLogFile"
      >
        <SvgIcon name="open_in_file_browser" />
      </button>
    </div>
    <div v-if="liveSnapshot" class="notice" role="status">
      {{ getText('engineLogsPagedBack') }}
      <button type="button" class="link" @click="backToLive">
        {{ getText('engineLogsBackToLive') }}
      </button>
    </div>
    <div v-if="downloadError != null" class="notice error" role="alert">
      {{ getText('engineLogsDownloadFailed', downloadError) }}
    </div>
    <div v-if="loading" class="notice" role="status">
      {{ getText('engineLogsLoadingHistory') }}
    </div>
    <div v-if="loadError != null" class="notice error" role="alert">
      {{ getText('engineLogsHistoryFailed', loadError) }}
    </div>
    <div v-if="!live && windowHasNoFiles && !loading" class="notice" role="status">
      {{ getText('engineLogsSessionMissing') }}
    </div>
    <EngineLogList
      v-model:follow="follow"
      class="list"
      :rows="shownRows"
      :canLoad="!loading"
      @reachedTop="onReachedTop"
      @loadOlder="loadOlder"
      @loadNewer="loadNewer"
    />
    <div v-if="live && stream?.state.waiting" class="notice" role="status">
      {{ getText('engineLogsWaiting') }}
    </div>
    <div v-else-if="live && stream?.state.ended != null" class="notice" role="status">
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
  /* A narrow dock wraps the filters rather than pushing the session picker out of view. */
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  padding: 4px 8px;
  font-size: 12px;
}

.toolbar select,
.toolbar input[type='search'],
.toolbar button {
  height: 22px;
  padding: 0 6px;
  border-radius: 6px;
  border: 1px solid var(--color-dim);
  background-color: white;
  font: inherit;
}

.toolbar input[type='search'] {
  width: 16em;
}

.toolbar .loggerFilter {
  width: 12em;
}

.notice .link {
  margin-left: 6px;
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  text-decoration: underline;
  cursor: pointer;
}

.toolbar .sourcesButton {
  display: flex;
  align-items: center;
  gap: 4px;
  max-width: 16em;
  cursor: pointer;
}

.toolbar .sourcesButton:focus-visible,
.origin input:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 1px;
}

.sourcesLabel {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sourcesArrow {
  flex: none;
  width: 10px;
  height: 10px;
  --icon-transform: rotate(90deg);
  --icon-transform-origin: center;
}

/* In the popover, which is teleported out of the panel. */
.origins {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 4px 6px;
  border: none;
  font-size: 12px;
  color: var(--color-text);
}

.origin {
  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  cursor: pointer;
}

.origin input {
  margin: 0;
  accent-color: var(--color-text);
  cursor: pointer;
}

.spacer {
  flex: 1;
}

.toolbar .iconButton {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  padding: 0;
  cursor: pointer;
}

.toolbar .iconButton:disabled {
  opacity: 0.4;
  cursor: default;
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
