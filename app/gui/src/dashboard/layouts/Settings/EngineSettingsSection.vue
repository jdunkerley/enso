<script setup lang="ts">
/**
 * @file The Local tab's Engine section: the "Pre-start the engine" switch
 * (`$/providers/spareEngineSettings`). `tabs.ts` shows it only when projects get the JVM engine.
 */
import Form from '$/components/Form/Form.vue'
import Switch from '$/components/Switch/Switch.vue'
import { setPreStartEngine, usePreStartEngine } from '$/providers/spareEngineSettings'
import { useText } from '$/providers/text'

const { getText } = useText()
const preStart = usePreStartEngine()

function onChange(name: string, value: unknown) {
  if (name === 'preStart') setPreStartEngine(value === true)
}
</script>

<template>
  <div class="flex flex-col gap-2" data-testid="engine-settings-section">
    <Form
      :schema="(z) => z.object({ preStart: z.boolean() })"
      :defaultValues="{ preStart }"
      @change="(name, value) => onChange(name, value)"
    >
      <Switch
        name="preStart"
        :label="getText('preStartEngineSetting')"
        :description="getText('preStartEngineSettingDescription')"
      />
    </Form>
  </div>
</template>
