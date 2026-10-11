<script setup lang="ts">
/**
 * @file Renders its default slot with a field's current value. In script, a
 * `computed(() => form.watch(name))` does the same.
 */
import { computed } from 'vue'
import { useFormContext } from './formContext'
import type { AnyFormInstance } from './types'

const { name, form } = defineProps<{
  name: string
  form?: AnyFormInstance | undefined
}>()

defineSlots<{ default: (props: { value: unknown }) => unknown }>()

const formInstance = useFormContext(form)
const value = computed(() => formInstance.watch(name as never))
</script>

<template>
  <slot :value="value" />
</template>
