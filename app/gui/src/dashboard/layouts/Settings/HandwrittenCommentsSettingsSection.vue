<script setup lang="ts">
/** @file A switch for the "Handwritten comments" setting (see `$/providers/codeFont`). */
import Form from '$/components/Form/Form.vue'
import Switch from '$/components/Switch/Switch.vue'
import { setHandwrittenComments, useHandwrittenComments } from '$/providers/codeFont'
import { useText } from '$/providers/text'

const { getText } = useText()
const handwrittenComments = useHandwrittenComments()
</script>

<template>
  <Form
    :schema="(z) => z.object({ handwrittenComments: z.boolean() })"
    :defaultValues="{ handwrittenComments }"
    @change="(_name, value) => setHandwrittenComments(value === true)"
  >
    <Switch
      name="handwrittenComments"
      :label="getText('handwrittenCommentsSetting')"
      :description="getText('handwrittenCommentsSettingDescription')"
    />
  </Form>
</template>
