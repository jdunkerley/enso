<script setup lang="ts">
/** @file A switch for the "Code ligatures" setting (see `$/providers/codeFont`). */
import Form from '$/components/Form/Form.vue'
import Switch from '$/components/Switch/Switch.vue'
import { setCodeLigatures, useCodeLigatures } from '$/providers/codeFont'
import { useText } from '$/providers/text'

const { getText } = useText()
const codeLigatures = useCodeLigatures()
</script>

<template>
  <Form
    :schema="(z) => z.object({ codeLigatures: z.boolean() })"
    :defaultValues="{ codeLigatures }"
    @change="(_name, value) => setCodeLigatures(value === true)"
  >
    <Switch
      name="codeLigatures"
      :label="getText('codeLigaturesSetting')"
      :description="getText('codeLigaturesSettingDescription')"
    />
  </Form>
</template>
