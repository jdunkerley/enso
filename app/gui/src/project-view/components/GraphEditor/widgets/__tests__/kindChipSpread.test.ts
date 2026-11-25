/**
 * @file The kind picker (priority 44) hands its chip down to `WidgetArgumentName` (100) on the input
 * (`KindChipKey`), so every widget between the two must pass on its own input, spread, to the
 * `NodeWidget` it draws inside itself: a widget that builds a fresh input loses the chip and the
 * argument's name. This test reads each such widget's source and checks that its inner input is built
 * from its own (`...props.input`, or a helper below that spreads it).
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { expect, test } from 'vitest'

const WIDGETS = path.resolve(__dirname, '..')
const KIND_PICKER_PRIORITY = 44
const ARGUMENT_NAME_PRIORITY = 100

/** How an inner input may be built from the widget's own: spread, or a helper that spreads it. */
const PASSES_INPUT_ON = [
  /\.\.\.props\.input\b/,
  /\.\.\.props\.widget\.input\b/,
  /\bwithDropdownItems\(props\.input\b/,
  /\bwithBrowserItems\(props\.input\b/,
]

const read = (file: string) => fs.readFileSync(path.join(WIDGETS, file), 'utf-8')

/** The priority a widget's `defineWidget` declares, or `undefined` for a file that defines none. */
function priorityOf(source: string): number | undefined {
  if (!source.includes('defineWidget(')) return undefined
  const match = source.match(/priority:\s*(-?\d+)/)
  if (match == null) throw new Error('A widget whose priority is not a number literal')
  return Number(match[1])
}

/** The code defining `name` (`const name = computed(…)`), up to the end of its statement. */
function definitionOf(source: string, name: string): string {
  const start = source.search(new RegExp(`const ${name}\\b[^=]*=`))
  if (start < 0) throw new Error(`No definition of ${name}`)
  const end = source.indexOf('\n})', start)
  return source.slice(start, end < 0 ? undefined : end)
}

/** Why `source`'s inner inputs might lose the kind chip; empty when they keep it. */
function problems(source: string, file: string): string[] {
  const template = source.slice(source.indexOf('<template>'))
  const inputs = [...template.matchAll(/<NodeWidget\b[^>]*?:input="([^"]+)"/g)].map((m) => m[1]!)
  const shells = [...template.matchAll(/<PickerShell\b[^>]*?:widget="props"/g)]
  if (inputs.length === 0 && shells.length === 0) return [`${file} draws no NodeWidget`]
  return inputs.flatMap((input) => {
    if (input === 'props.input') return []
    if (!/^\w+$/.test(input)) return [`${file} passes ${input}, not a named input`]
    const definition = definitionOf(source, input)
    return PASSES_INPUT_ON.some((pattern) => pattern.test(definition)) ?
        []
      : [`${file}: ${input} is not built from props.input`]
  })
}

const band = fs
  .readdirSync(WIDGETS)
  .filter((file) => file.endsWith('.vue'))
  .map((file) => ({ file, source: read(file) }))
  .map(({ file, source }) => ({ file, source, priority: priorityOf(source) }))
  .filter(
    ({ priority }) =>
      priority != null && priority > KIND_PICKER_PRIORITY && priority < ARGUMENT_NAME_PRIORITY,
  )

test('the widgets between the kind picker and the argument name are found', () => {
  // A sanity check of the parsing above, not a list to keep: any widget in the band is checked.
  expect(band.map(({ file }) => file)).toEqual(
    expect.arrayContaining(['WidgetFileBrowser.vue', 'WidgetSelection.vue', 'WidgetDate.vue']),
  )
})

test.each(band.map(({ file, source }) => [file, source]))(
  '%s passes its own input on to its inner widget',
  (file, source) => {
    expect(problems(source, file)).toEqual([])
  },
)

test('the date and time pickers’ shell passes the input on', () => {
  expect(problems(read('WidgetPicker/PickerShell.vue'), 'PickerShell.vue')).toEqual([])
})

test('the check catches an inner input built afresh', () => {
  const fresh = `<script setup lang="ts">
const inner = computed(() => ({ portId: props.input.portId, value: props.input.value }))
</script>
<template><NodeWidget :input="inner" /></template>`
  expect(problems(fresh, 'Fresh.vue')).toEqual(['Fresh.vue: inner is not built from props.input'])
  expect(
    problems('<template><NodeWidget :input="WidgetInput.FromAst(x)" /></template>', 'X.vue'),
  ).toEqual(['X.vue passes WidgetInput.FromAst(x), not a named input'])
})
