<script lang="ts">
export const name = 'SQL Query'
export const icon = 'braces'
export const inputType =
  'Standard.Database.DB_Table.DB_Table | Standard.Database.DB_Column.DB_Column'
export const defaultPreprocessor = [
  'Standard.Visualization.SQL.Visualization',
  'prepare_visualization',
] as const

/**
 * A visualization that pretty-prints generated SQL code and displays type hints related to
 * interpolated query parameters.
 *
 * Shipped by Standard.Database and compiled by the IDE at run time, so it imports only `vue` and the
 * IDE's lazy `sql-formatter` module.
 */

type Data = SQLData | Error

interface SQLData {
  error: undefined
  dialect: string | undefined
  code: string
  interpolations: SQLInterpolation[] | undefined
}

interface SQLInterpolation {
  enso_type: string
  value: unknown
}

interface Error {
  error: string
  dialect: undefined
  code: undefined
  interpolations: undefined
}
</script>

<script setup lang="ts">
import { format, supportedDialects } from 'sql-formatter'
import { computed } from 'vue'

const props = defineProps<{ data: Data }>()

const language = computed(() =>
  props.data.dialect != null && supportedDialects.includes(props.data.dialect) ?
    props.data.dialect
  : 'sql',
)
const formatted = computed(() => {
  if (props.data.error != null || props.data.code == null) {
    return undefined
  }
  const params = (props.data.interpolations ?? []).map(renderInterpolationParameter)
  return format(props.data.code, { params, language: language.value })
})

interface RGBA {
  red: number
  green: number
  blue: number
  alpha: number
}

/** A colour for an Enso type: a hash of its qualified name (the GUI's former `DEFAULT_THEME`). */
function colorForType(type: string): RGBA {
  let hash = 0
  for (const c of type) {
    hash = 0 | (hash * 31 + c.charCodeAt(0))
  }
  if (hash < 0) {
    hash += 0x80000000
  }
  const red = (hash >> 24) / 0x180
  const green = ((hash >> 16) & 0xff) / 0x180
  const blue = ((hash >> 8) & 0xff) / 0x180
  return { red, green, blue, alpha: 1 }
}

/**
 * Let Mod+C (Ctrl, or Cmd on macOS) copy the selected SQL rather than reach the graph editor's
 * copy (the GUI's `stopCopy`).
 */
function stopCopy(event: KeyboardEvent) {
  const isMac = /(Mac|iPhone|iPod|iPad)/i.test(navigator.platform)
  const mod = isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
  if (mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'c') {
    event.stopPropagation()
  }
}

/** The qualified name of the Text type. */
const TEXT_TYPE = 'Standard.Base.Data.Text.Text'
/** The qualified name of the Date type. */
const DATE_TYPE = 'Standard.Base.Data.Time.Date.Date'
/** Specifies opacity of interpolation background color. */
const INTERPOLATION_BACKGROUND_OPACITY = 0.2

// === Handling Colors ===

/** Render a 4-element array representing a color into a CSS-compatible rgba string. */
function convertColorToRgba(color: RGBA) {
  const r = 255 * color.red
  const g = 255 * color.green
  const b = 255 * color.blue
  const a = color.alpha
  return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')'
}

/**
 * Replace the alpha component of a color (represented as a 4-element array),
 * returning a new color.
 */
function replaceAlpha(color: RGBA, newAlpha: number) {
  return {
    red: color.red,
    green: color.green,
    blue: color.blue,
    alpha: newAlpha,
  }
}

/** Renders HTML for displaying an Enso parameter that is interpolated into the SQL code. */
function renderInterpolationParameter(param: SQLInterpolation) {
  const value = formatInterpolationParameter(param)
  const fgColor = colorForType(param.enso_type)
  const bgColor = replaceAlpha(fgColor, INTERPOLATION_BACKGROUND_OPACITY)

  return renderRegularInterpolation(value, fgColor, bgColor)
}

function formatInterpolationParameter(param: { enso_type: string; value: unknown }) {
  const formatTextLiteral = (lit: string) => "'" + lit.replace(/'/g, "''") + "'"
  switch (param.enso_type) {
    case TEXT_TYPE:
      return formatTextLiteral(`${param.value}`)
    case DATE_TYPE:
      if (
        param.value != null &&
        typeof param.value === 'object' &&
        'year' in param.value &&
        'month' in param.value &&
        'day' in param.value
      ) {
        const yearStr = `${param.value.year}`.padStart(4, '0')
        const monthStr = `${param.value.month}`.padStart(2, '0')
        const dayStr = `${param.value.day}`.padStart(2, '0')
        return formatTextLiteral(`${yearStr}-${monthStr}-${dayStr}`)
      }
      break
  }
  return `${param.value}`
}

/** A helper that renders the HTML representation of a regular SQL interpolation. */
function renderRegularInterpolation(value: unknown, fgColor: RGBA, bgColor: RGBA) {
  let html = `<div class="interpolation" style="color:${convertColorToRgba(
    fgColor,
  )};background-color:${convertColorToRgba(bgColor)};">`
  html += value
  html += '</div>'
  return html
}
</script>

<template>
  <div class="SQLVisualization scrollable" tabindex="-1" @wheel.stop.passive @keydown="stopCopy">
    <pre v-if="data.error" class="sql" v-text="data.error"></pre>
    <!-- eslint-disable-next-line vue/no-v-html This is SAFE, beause it is not user input. -->
    <pre v-else class="sql" v-html="formatted"></pre>
  </div>
</template>

<style scoped>
.SQLVisualization {
  padding: 4px;
  user-select: text;
}

:deep(.sql) {
  font-family: var(--font-mono);
  font-variant-ligatures: var(--font-mono-readonly-variant-ligatures);
  font-feature-settings: var(--font-mono-readonly-feature-settings);
  font-size: 12px;
  margin-left: 7px;
  margin-top: 5px;
}

:deep(.interpolation) {
  border-radius: 6px;
  padding: 1px 2px 1px 2px;
  display: inline;
}

:deep(.mismatch-parent) {
  position: relative;
  display: inline-flex;
  justify-content: center;
}

:deep(.mismatch-mouse-area) {
  display: inline;
  position: absolute;
  width: 150%;
  height: 150%;
  align-self: center;
  z-index: 0;
}

:deep(.mismatch) {
  z-index: 1;
}

:deep(.modulepath) {
  color: rgba(150, 150, 150, 0.9);
}

:deep(.tooltip) {
  font-family: var(--font-mono);
  font-variant-ligatures: var(--font-mono-readonly-variant-ligatures);
  font-feature-settings: var(--font-mono-readonly-feature-settings);
  font-size: 12px;
  opacity: 0;
  transition: opacity 0.2s;
  display: inline-block;
  white-space: nowrap;
  background-color: rgba(249, 249, 249, 1);
  box-shadow: 0 0 16px rgba(0, 0, 0, 0.16);
  text-align: left;
  border-radius: 6px;
  padding: 5px;
  position: absolute;
  z-index: 99999;
  pointer-events: none;
}
</style>
