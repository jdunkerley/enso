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

/** Escape text for an HTML context. */
function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

/**
 * A name for each parameter that sql-formatter copies through unchanged, swapped for the value
 * after escaping. The prefix is lengthened until the SQL text itself cannot contain it, so a name
 * in the SQL that looks like a placeholder is never taken for one.
 */
function placeholderPrefixFor(code: string) {
  let prefix = '__enso_param_'
  for (let nonce = 1; code.includes(prefix); nonce += 1) {
    prefix = `__enso_param${nonce}_`
  }
  return prefix
}

/** The words that are coloured as keywords (compared in upper case). */
const KEYWORDS = new Set(
  (
    'ADD ALL ALTER AND ANY AS ASC BETWEEN BY CASE CAST CHECK COLUMN CONSTRAINT CREATE CROSS ' +
    'CURRENT DEFAULT DELETE DESC DISTINCT DROP ELSE END EXCEPT EXISTS FALSE FETCH FILTER FIRST ' +
    'FOLLOWING FOR FOREIGN FROM FULL GROUP HAVING IF ILIKE IN INDEX INNER INSERT INTERSECT ' +
    'INTO IS JOIN KEY LAST LATERAL LEFT LIKE LIMIT NATURAL NOT NULL NULLS OFFSET ON OR ORDER ' +
    'OUTER OVER PARTITION PRECEDING PRIMARY RANGE RECURSIVE REFERENCES RIGHT ROW ROWS SELECT SET ' +
    'SIMILAR TABLE THEN TOP TRUE UNBOUNDED UNION UNIQUE UPDATE USING VALUES VIEW WHEN WHERE ' +
    'WINDOW WITH'
  ).split(' '),
)

/**
 * The keywords that are also common function names (`LEFT(a, 3)`, `IF(b, 1, 2)`). They are coloured
 * only when no `(` follows. It is not a rule for every keyword: `IN (`, `AND (` and `OVER (` are
 * keywords. `FILTER` is left out, since `FILTER (WHERE …)` is the keyword.
 */
const KEYWORDS_ALSO_FUNCTIONS = new Set(['FIRST', 'IF', 'LAST', 'LEFT', 'RANGE', 'RIGHT', 'ROW'])

/** Whether the text from `index` on begins, after optional whitespace, with `(`. */
function opensCall(text: string, index: number) {
  const open = /\s*\(/y
  open.lastIndex = index
  return open.test(text)
}

/** Whether a word, which ends at `end` in `text`, is coloured as a keyword. */
function isKeyword(text: string, word: string, end: number) {
  const upper = word.toUpperCase()
  return KEYWORDS.has(upper) && !(KEYWORDS_ALSO_FUNCTIONS.has(upper) && opensCall(text, end))
}

/** The kinds of coloured token, each shown with the class `tok-<kind>`. */
type TokenKind = 'keyword' | 'string' | 'identifier' | 'number' | 'comment'

/** Wrap already-escaped text in a coloured token. */
function renderToken(kind: TokenKind, text: string) {
  return `<span class="tok-${kind}">${escapeHtml(text)}</span>`
}

/**
 * The pattern of the tokens that are coloured. A comment or a string is matched whole, so a quote
 * in a comment, or `--` or a keyword in a string, is not read as anything else. What matches
 * none of them (operators, punctuation, spaces, other names) is left as it is.
 */
function tokenPattern(prefix: string, bracketIdentifiers: boolean) {
  const placeholder = `${prefix}\\d+__`
  const word = `(?!${placeholder})[\\p{L}_](?:(?!${placeholder})[\\p{L}\\p{N}_$])*`
  return new RegExp(
    [
      `(?<placeholder>${prefix}(?<index>\\d+)__)`,
      `(?<comment>--[^\\n]*|/\\*[\\s\\S]*?(?:\\*/|$))`,
      `(?<string>'(?:[^']|'')*(?:'|$))`,
      `(?<identifier>"(?:[^"]|"")*(?:"|$)|\`(?:[^\`]|\`\`)*(?:\`|$)${
        // No `[` inside, so an unclosed one fails at the next `[` rather than rescanning the line.
        bracketIdentifiers ? '|\\[[^\\]\\[\\n]*\\]' : ''
      })`,
      `(?<number>\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?\\b)`,
      `(?<word>${word})`,
    ].join('|'),
    'gu',
  )
}

/**
 * The HTML of formatted SQL: its tokens coloured and its placeholders replaced by the values. The
 * text is tokenized before it is escaped, and each piece is escaped on its own as it is wrapped, so
 * no SQL (or value) text reaches the page unescaped. A value is a chip and never tokenized.
 *
 * The placeholder is matched first, but never has to be found inside a string, quoted name or
 * comment: sql-formatter substitutes only `?` tokens, and a `?` inside one of those is not a token,
 * so a placeholder never sits inside a quoted piece of the formatted text.
 */
function highlightSql(
  text: string,
  prefix: string,
  interpolations: SQLInterpolation[],
  bracketIdentifiers: boolean,
) {
  const pattern = tokenPattern(prefix, bracketIdentifiers)
  let html = ''
  let end = 0
  for (const match of text.matchAll(pattern)) {
    html += escapeHtml(text.slice(end, match.index))
    end = match.index + match[0].length
    const groups = match.groups!
    const interpolation =
      groups.placeholder != null ? interpolations[Number(groups.index)] : undefined
    if (groups.placeholder != null) {
      html +=
        interpolation != null ? renderInterpolationParameter(interpolation) : escapeHtml(match[0])
    } else if (groups.comment != null) {
      html += renderToken('comment', match[0])
    } else if (groups.string != null) {
      html += renderToken('string', match[0])
    } else if (groups.identifier != null) {
      html += renderToken('identifier', match[0])
    } else if (groups.number != null) {
      html += renderToken('number', match[0])
    } else if (isKeyword(text, match[0], end)) {
      html += renderToken('keyword', match[0])
    } else {
      html += escapeHtml(match[0])
    }
  }
  return html + escapeHtml(text.slice(end))
}

const formatted = computed(() => {
  if (props.data.error != null || props.data.code == null) {
    return undefined
  }
  const interpolations = props.data.interpolations ?? []
  const prefix = placeholderPrefixFor(props.data.code)
  const text = format(props.data.code, {
    params: interpolations.map((_, index) => `${prefix}${index}__`),
    language: language.value,
  })
  // `[name]` quotes an identifier in these dialects; elsewhere it is a subscript.
  const bracketIdentifiers = language.value === 'transactsql' || language.value === 'sqlite'
  return highlightSql(text, prefix, interpolations, bracketIdentifiers)
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
  const isMac = /mac os/i.test(navigator.userAgent)
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
  html += escapeHtml(String(value))
  html += '</div>'
  return html
}
</script>

<template>
  <div class="SQLVisualization scrollable" tabindex="-1" @wheel.stop.passive @keydown="stopCopy">
    <pre v-if="data.error" class="sql" v-text="data.error"></pre>
    <!-- eslint-disable-next-line vue/no-v-html The code and every value are escaped (escapeHtml); only our own `div.interpolation` wrappers are markup. -->
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

/*
 * The colours of the code editor's default highlight style (CodeMirror's `defaultHighlightStyle`).
 * A quoted identifier takes that palette's colour for special strings (`#e40`; it has no
 * identifier tag of its own).
 */
:deep(.tok-keyword) {
  color: #708;
}

:deep(.tok-string) {
  color: #a11;
}

:deep(.tok-identifier) {
  color: #e40;
}

:deep(.tok-number) {
  color: #164;
}

:deep(.tok-comment) {
  color: #940;
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
