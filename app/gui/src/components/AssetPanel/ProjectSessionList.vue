<script setup lang="ts">
/**
 * @file The sessions of one project, newest first, each with a button showing its logs. It waits
 * for them in `setup`, so it must be inside a `SuspenseLoader` (React's `useSuspenseQuery`).
 */
import Result from '$/components/Result/Result.vue'
import Scroller from '$/components/Scroller/Scroller.vue'
import type { SessionsProject } from '$/providers/rightPanel'
import { useText } from '$/providers/text'
import { useQuery } from '@tanstack/vue-query'
import type { Backend } from 'enso-common/src/services/Backend'
import { computed } from 'vue'
import ProjectSession from './ProjectSession.vue'

const { backend, project } = defineProps<{
  backend: Backend
  project: SessionsProject
}>()

const { getText } = useText()

const sessionsQuery = useQuery({
  // React's key, unchanged: a session list cached (and persisted) by the React tab stays valid.
  queryKey: ['getProjectSessions', project.id, project.title],
  queryFn: async () => {
    const sessions = await backend.listProjectSessions(project.id, project.title)
    return [...sessions].reverse()
  },
  throwOnError: true,
})
await sessionsQuery.suspense()

const sessions = computed(() => sessionsQuery.data.value ?? [])
</script>

<template>
  <Result
    v-if="sessions.length === 0"
    status="info"
    :centered="true"
    :title="getText('assetProjectSessions.noSessions')"
  />
  <div v-else class="flex min-h-0 w-full flex-col justify-start">
    <Scroller scrollbar orientation="vertical" background="white" class="h-full">
      <ProjectSession
        v-for="(session, i) in sessions"
        :key="session.projectSessionId"
        :project="project"
        :projectSession="session"
        :index="sessions.length - i"
      />
    </Scroller>
  </div>
</template>
