<script setup lang="ts">
/** @file A switch for the "Include prerelease versions" setting (see `$/providers/updateSettings`). */
import Form from '$/components/Form/Form.vue'
import Switch from '$/components/Switch/Switch.vue'
import { useText } from '$/providers/text'
import { setIncludePrereleases, useIncludePrereleases } from '$/providers/updateSettings'

const { getText } = useText()
const includePrereleases = useIncludePrereleases()
</script>

<template>
  <Form
    :schema="(z) => z.object({ includePrereleases: z.boolean() })"
    :defaultValues="{ includePrereleases }"
    @change="(_name, value) => setIncludePrereleases(value === true)"
  >
    <Switch
      name="includePrereleases"
      :label="getText('includePrereleasesSetting')"
      :description="getText('includePrereleasesSettingDescription')"
    />
  </Form>
</template>
