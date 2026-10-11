<script setup lang="ts">
/**
 * @file A password input with a show/hide button.
 * Every prop and attribute falls through to `Input.vue`; the button appears once there is a value.
 */
import Button from '$/components/Button/Button.vue'
import { useFormContext } from '$/components/Form/formContext'
import type { AnyFormInstance } from '$/components/Form/types'
import { computed, ref } from 'vue'
import Input from './Input.vue'

const { name, form } = defineProps<{
  name: string
  form?: AnyFormInstance | undefined
}>()

const formInstance = useFormContext(form)
const showPassword = ref(false)
const hasValue = computed(() => {
  const value = formInstance.watch(name as never)
  return typeof value === 'string' && value.length > 0
})
</script>

<template>
  <Input :name="name" :form="formInstance" :type="showPassword ? 'text' : 'password'">
    <template #addonEnd>
      <slot name="addonEnd" />
      <Button
        v-if="hasValue"
        size="medium"
        variant="icon"
        extraClickZone
        :icon="showPassword ? 'eye' : 'eye_crossed'"
        @press="showPassword = !showPassword"
      />
    </template>
  </Input>
</template>
