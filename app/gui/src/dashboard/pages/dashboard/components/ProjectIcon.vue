<script setup lang="ts">
/**
 * @file The button showing a project's state in the drive's name cell, which opens it, or stops it
 * while it is opening or open, with its test ids (`open-project`, `stop-project`), labels and
 * tooltips.
 */
import { STOP_PRESS_PROPAGATION } from '#/layouts/Drive/pressPropagation'
import Button from '$/components/Button/Button.vue'
import Spinner from '$/components/Spinner/Spinner.vue'
import StatelessSpinner from '$/components/Spinner/StatelessSpinner.vue'
import type { SpinnerPhase } from '$/components/Spinner/variants'
import { useAuth } from '$/providers/auth'
import { useContainerData, type Tab } from '$/providers/container'
import { useOpenedProjects } from '$/providers/openedProjects'
import { useText } from '$/providers/text'
import { twJoin, twMerge } from '$/utils/style/tailwindMerge'
import {
  BackendType,
  ProjectState,
  type Backend,
  type ProjectAsset,
} from 'enso-common/src/services/Backend'
import { computed } from 'vue'

const {
  backend,
  item,
  isDisabled: isDisabledRaw,
} = defineProps<{
  backend: Backend
  isDisabled: boolean
  item: ProjectAsset
}>()

const container = useContainerData()
const openedProjects = useOpenedProjects()
const auth = useAuth()
const { getText } = useText()

const isUnconditionallyDisabled = computed(() => !container.canOpenProjectLocally(backend.type))

// A workaround for a temporary bad state in the backend, in which `projectState` is absent.
const projectState = computed(() => item.projectState ?? CLOSED_PROJECT_STATE)
const isRunningInBackground = computed(() => projectState.value.executeAsync ?? false)
const isOtherUserUsingProject = computed(
  () =>
    projectState.value.openedBy != null && projectState.value.openedBy !== auth.session?.user.email,
)

const isProjectOpening = computed(() => openedProjects.isProjectOpening(item))
const isProjectOpened = computed(() => openedProjects.isProjectOpened(item))
const isProjectClosing = computed(() => openedProjects.isProjectClosing(item.id))
const isAnotherProjectOpening = computed(
  () =>
    [...openedProjects.listProjects()].some(
      (project) => project.state.info.id !== item.id && project.nextTask?.process === 'opening',
    ) && !isProjectOpening.value,
)
const isDisabled = computed(
  () =>
    isDisabledRaw ||
    isUnconditionallyDisabled.value ||
    isAnotherProjectOpening.value ||
    isProjectClosing.value,
)

const spinnerState = computed((): SpinnerPhase => {
  const status = projectState.value.type
  return backend.type === BackendType.remote ?
      REMOTE_SPINNER_STATE[status]
    : LOCAL_SPINNER_STATE[status]
})

function tooltip(defaultTooltip: string) {
  if (isUnconditionallyDisabled.value) return getText('downloadToOpenWorkflow')
  if (isOtherUserUsingProject.value) {
    return getText('xIsUsingTheProject', projectState.value.openedBy ?? '')
  }
  if (isAnotherProjectOpening.value) return getText('anotherProjectIsBeingOpenedError')
  if (isProjectClosing.value) return getText('syncingProjectFiles')
  return defaultTooltip
}

function doOpenProject() {
  container.openProjectLocally(item, backend.type)
}

function doCloseProject() {
  const tab: Tab = { type: 'project', id: item.id }
  if (container.isTabOpened(tab)) container.closeTab(tab)
  else openedProjects.closeProject(item.id, { asset: item, backendType: backend.type })
}
</script>

<script lang="ts">
export const CLOSED_PROJECT_STATE = { type: ProjectState.closed } as const

/** The spinner's phase for each project state, on the cloud. */
const REMOTE_SPINNER_STATE: Readonly<Record<ProjectState, SpinnerPhase>> = {
  [ProjectState.closed]: 'loading-slow',
  [ProjectState.created]: 'loading-slow',
  [ProjectState.new]: 'loading-slow',
  [ProjectState.placeholder]: 'loading-slow',
  [ProjectState.openInProgress]: 'loading-slow',
  [ProjectState.hybridOpenInProgress]: 'loading-slow',
  [ProjectState.provisioned]: 'loading-slow',
  [ProjectState.scheduled]: 'loading-slow',
  [ProjectState.opened]: 'done',
  [ProjectState.hybridOpened]: 'done',
}
/** The spinner's phase for each project state, on the local backend. */
const LOCAL_SPINNER_STATE: Readonly<Record<ProjectState, SpinnerPhase>> = {
  [ProjectState.closed]: 'loading-slow',
  [ProjectState.created]: 'loading-slow',
  [ProjectState.new]: 'loading-slow',
  [ProjectState.placeholder]: 'loading-medium',
  [ProjectState.openInProgress]: 'loading-slow',
  [ProjectState.hybridOpenInProgress]: 'loading-slow',
  [ProjectState.provisioned]: 'loading-medium',
  [ProjectState.scheduled]: 'loading-medium',
  [ProjectState.opened]: 'done',
  [ProjectState.hybridOpened]: 'done',
}
</script>

<template>
  <div v-if="isProjectOpening" class="relative flex">
    <Button
      size="large"
      variant="icon"
      extraClickZone="xsmall"
      :isDisabled="isDisabled || isOtherUserUsingProject"
      icon="workflow_stop"
      :aria-label="tooltip(getText('stopExecution'))"
      tooltipPlacement="left"
      :class="twJoin(isRunningInBackground && 'text-green')"
      testId="stop-project"
      v-bind="STOP_PRESS_PROPAGATION"
      @press="doCloseProject"
    />
    <StatelessSpinner
      :phase="spinnerState"
      :class="twJoin('pointer-events-none absolute inset-0', isRunningInBackground && 'text-green')"
    />
  </div>
  <div v-else-if="isProjectOpened" class="flex flex-row gap-0.5">
    <div class="relative flex">
      <Button
        size="large"
        variant="icon"
        extraClickZone="xsmall"
        :isDisabled="isDisabled || isOtherUserUsingProject"
        icon="workflow_stop"
        :aria-label="tooltip(getText('stopExecution'))"
        tooltipPlacement="left"
        :class="twJoin(isRunningInBackground && 'text-green')"
        testId="stop-project"
        v-bind="STOP_PRESS_PROPAGATION"
        @press="doCloseProject"
      />
      <Spinner
        phase="done"
        :class="
          twMerge('pointer-events-none absolute inset-0', isRunningInBackground && 'text-green')
        "
      />
    </div>
  </div>
  <Button
    v-else
    size="large"
    variant="icon"
    icon="workflow_play"
    :aria-label="tooltip(getText('openInEditor'))"
    tooltipPlacement="left"
    extraClickZone="xsmall"
    :isDisabled="isDisabled"
    class="shrink-0"
    testId="open-project"
    v-bind="STOP_PRESS_PROPAGATION"
    @press="doOpenProject"
  />
</template>
