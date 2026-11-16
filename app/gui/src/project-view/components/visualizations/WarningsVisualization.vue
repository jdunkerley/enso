<script lang="ts">
import { useVisualizationConfig } from '@/util/visualizationBuiltins'
import { computed } from 'vue'
import { parseVizActions, plainActionToolbar } from './vizActions'

export const name = 'Warnings'
export const icon = 'exclamation'
export const inputType = 'Standard.Base.Any.Any'
export const defaultPreprocessor = [
  'Standard.Visualization.Warnings',
  'process_to_json_text',
] as const
</script>

<script setup lang="ts">
type Error = {
  type?: string
  content?: {
    argument_name?: string
    call_location?: string
    constructor?: string
    function_name?: string
    type?: string
  }
  message?: string
}

type Warning = string[]

type Message = { warnings: Warning; actions?: unknown }

type Data = Error | Warning | Message

const props = defineProps<{ data: Data }>()
const config = useVisualizationConfig()

const messages = computed(() => {
  const data = props.data
  if (Array.isArray(data)) return data
  if (typeof data === 'object' && data !== null && 'warnings' in data) return data.warnings
  if (typeof data === 'object' && data !== null && 'message' in data) return [data.message]
  return []
})

const isRemoveWarningsDisabled = computed(() => messages.value.length === 0)

config.setToolbar(
  computed(() =>
    plainActionToolbar(parseVizActions(props.data), config.createNodes, (action) =>
      action.id === 'remove_warnings' ? isRemoveWarningsDisabled : false,
    ),
  ),
)
</script>

<template>
  <div class="WarningsVisualization">
    <ul>
      <li v-if="messages.length === 0">There are no warnings.</li>
      <li v-for="(warning, index) in messages" :key="index" v-text="warning"></li>
    </ul>
  </div>
</template>

<style scoped>
.WarningsVisualization {
  padding: 8px;
}

ul {
  white-space: pre;
  padding-inline-start: 0;
}

li {
  list-style: none;
}
</style>
