<script setup lang="ts">
/** @file One session of a project: its number and date, and a button opening its logs in a tab. */
import Button from '$/components/Button/Button.vue'
import { useContainerData } from '$/providers/container'
import { useText } from '$/providers/text'
import type { ProjectSession } from 'enso-common/src/services/Backend'
import { toReadableIsoString } from 'enso-common/src/utilities/data/dateTime'

const { project, projectSession, index } = defineProps<{
  project: { readonly title: string }
  projectSession: ProjectSession
  /** The session's number, counting from the oldest. */
  index: number
}>()

const { getText } = useText()
const container = useContainerData()
</script>

<template>
  <div class="flex flex-row gap-4 rounded-2xl p-2">
    <div class="flex flex-1 flex-col">
      {{ getText('projectSessionX', index)
      }}<time class="text-xs">{{
        getText('onDateX', toReadableIsoString(new Date(projectSession.createdAt)))
      }}</time>
    </div>
    <div class="flex items-center gap-1">
      <Button
        variant="icon"
        isActive
        icon="log"
        :aria-label="getText('showLogs')"
        @press="container.openProjectLogTab(projectSession.projectSessionId, project.title)"
      />
    </div>
  </div>
</template>
