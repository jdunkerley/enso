import { expect, test } from 'vitest'
import { compileSfc, compileTs } from '../compileSfc'

const SFC = `<script lang="ts">
export const name = 'Probe'
export const inputType = 'Standard.Base.Any.Any'
</script>
<script setup lang="ts">
const props = defineProps<{ data: { x: number } }>()
</script>
<template><span class="Probe">{{ props.data.x }}</span></template>
<style scoped>.Probe { color: red; }</style>`

test('a visualization SFC compiles to JavaScript with its exports and scoped style', () => {
  const { code, styles, id } = compileSfc(SFC, 'Probe.vue')
  expect(code).toContain("export const name = 'Probe'")
  expect(code).not.toContain('defineProps<')
  expect(styles).toHaveLength(1)
  expect(styles[0]).toMatch(/\.Probe\[data-v-[0-9a-f]+\]/)
  expect(styles[0]).toContain(`data-v-${id}`)
})

test('a broken SFC throws', () => {
  expect(() => compileSfc('<script setup lang="ts">const = </script>', 'Bad.vue')).toThrow()
})

test('TypeScript compiles to JavaScript', () => {
  const code = compileTs('export const x: number = 1')
  expect(code).toContain('export const x = 1')
  expect(code).not.toContain(': number')
})
