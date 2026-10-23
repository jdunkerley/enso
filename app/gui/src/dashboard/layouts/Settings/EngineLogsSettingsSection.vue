<script setup lang="ts">
/**
 * @file The Local tab's Engine logs section: switches for logging SQL queries and performance
 * timings (see `$/providers/engineLogSettings`), and a note that they apply from the next time a
 * project's engine starts.
 */
import Form from '$/components/Form/Form.vue'
import Switch from '$/components/Switch/Switch.vue'
import Text from '$/components/Text/Text.vue'
import { setEngineLogSettings, useEngineLogSettings } from '$/providers/engineLogSettings'
import { useText } from '$/providers/text'

const { getText } = useText()
const settings = useEngineLogSettings()

function onChange(name: string, value: unknown) {
  const on = value === true
  if (name === 'sqlQueries') setEngineLogSettings({ sqlQueries: on })
  else if (name === 'performanceTimings') setEngineLogSettings({ performanceTimings: on })
}
</script>

<template>
  <div class="flex flex-col gap-2" data-testid="engine-logs-settings-section">
    <Form
      :schema="(z) => z.object({ sqlQueries: z.boolean(), performanceTimings: z.boolean() })"
      :defaultValues="{
        sqlQueries: settings.sqlQueries,
        performanceTimings: settings.performanceTimings,
      }"
      @change="(name, value) => onChange(name, value)"
    >
      <Switch
        name="sqlQueries"
        :label="getText('logSqlQueriesSetting')"
        :description="getText('logSqlQueriesSettingDescription')"
      />
      <Switch
        name="performanceTimings"
        :label="getText('logPerformanceTimingsSetting')"
        :description="getText('logPerformanceTimingsSettingDescription')"
      />
    </Form>
    <Text>{{ getText('engineLogsSettingsNextStart') }}</Text>
  </div>
</template>
