/**
 * @file With `format` on `Auto_Detect`, which format type's library the file a call's `path`
 * argument names needs: the one whose format options' file name patterns match it (#489,
 * `docs/superpowers/specs/2026-11-03-data-read-library-imports-design.md`, section 3).
 */
import type { WidgetUpdate } from '$/providers/openedProjects/widgetRegistry'
import {
  argsWidgetConfigurationSchema,
  flattenChoice,
  type WidgetConfiguration,
} from '$/providers/openedProjects/widgetRegistry/configuration'
import { Ast } from '@/util/ast'
import type { AstId } from '@/util/ast/abstract'
import { ArgumentAst, type ArgumentApplication, type ArgumentPlaceholder } from '@/util/callTree'
import { qnLastSegment, tryQualifiedName } from '@/util/qualifiedName'

/** The argument whose value is the file to read (`Data.read`'s). */
export const PATH_ARGUMENT = 'path'
/** The argument whose widget lists the formats and their file name patterns. */
export const FORMAT_ARGUMENT = 'format'

/**
 * The file name at the end of `path`: after the last `/` or `\`. A URL (`scheme://`) loses its
 * query and fragment; in a local path `?` and `#` are part of the name.
 */
export function fileNameOf(path: string): string {
  const withoutQuery = /^[a-z][a-z0-9+.-]*:\/\//i.test(path) ? path.replace(/[?#].*$/s, '') : path
  const lastSeparator = Math.max(withoutQuery.lastIndexOf('/'), withoutQuery.lastIndexOf('\\'))
  return withoutQuery.slice(lastSeparator + 1)
}

/**
 * Whether `fileName` matches a `File_Name_Pattern` pattern: `*` is any run of characters, `?` one
 * character, anything else literal. Case is ignored, as `Auto_Detect` ignores it
 * (`File_Format_Metadata.guess_extension` lower-cases the extension).
 */
export function matchesNamePattern(pattern: string, fileName: string): boolean {
  const source = Array.from(pattern, (c) =>
    c === '*' ? '.*'
    : c === '?' ? '.'
    : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
  ).join('')
  return new RegExp(`^${source}$`, 'is').test(fileName)
}

/**
 * The type whose library reads `path`, when the patterns of exactly one format type in
 * `formatConfig` match its file name. Several options of one type (Excel's Workbook, Sheet and
 * Range) count once.
 */
export function formatTypeForPath(
  path: string,
  formatConfig: WidgetConfiguration | undefined,
): string | undefined {
  if (formatConfig?.kind !== 'Single_Choice') return undefined
  const fileName = fileNameOf(path)
  if (fileName === '') return undefined
  const types = new Set<string>()
  for (const choice of formatConfig.values.flatMap(flattenChoice)) {
    if (choice.requires && choice.patterns?.some((p) => matchesNamePattern(p, fileName))) {
      types.add(choice.requires)
    }
  }
  return types.size === 1 ? [...types][0] : undefined
}

/** Whether a `format` argument's code is `Auto_Detect`, in any form the IDE inserts. */
export function isAutoDetect(code: string): boolean {
  if (code === '..Auto_Detect') return true
  const qn = tryQualifiedName(code)
  return qn.ok && qnLastSegment(qn.value) === 'Auto_Detect'
}

/** The text of the first text literal in `value`: a path, or the path in `File.new '…'`. */
export function pathTextOf(value: Ast.Ast | string | undefined): string | undefined {
  const ast = typeof value === 'string' ? Ast.parseExpression(value) : value
  if (ast == null) return undefined
  let text: string | undefined
  Ast.visitRecursive(ast, (node) => {
    if (text != null) return false
    if (node instanceof Ast.TextLiteral) {
      text = node.rawTextContent
      return false
    }
    return true
  })
  return text
}

function contains(ast: Ast.Ast, id: AstId): boolean {
  let found = false
  Ast.visitRecursive(ast, (node) => {
    if (node.id === id) found = true
    return !found
  })
  return found
}

/**
 * The path's text after `update`, when the update changes the `path` argument: a value set on its
 * port or inside it (the file browser, or typing into a placeholder), or its literal edited in
 * place (typing into it, which sends only `edit`).
 */
function newPathText(
  path: ArgumentAst | ArgumentPlaceholder,
  update: WidgetUpdate,
): string | undefined {
  const portUpdate = update.portUpdate
  if (portUpdate && 'value' in portUpdate) {
    const { origin, value } = portUpdate
    const inPath =
      origin === path.portId ||
      (path instanceof ArgumentAst && Ast.isAstId(origin) && contains(path.ast, origin))
    return inPath ? pathTextOf(value) : undefined
  }
  if (update.edit && path instanceof ArgumentAst) {
    return pathTextOf(update.edit.tryGet(path.ast.id))
  }
  return undefined
}

/**
 * The format type whose library the path that `update` sets needs, when the call has `path` and
 * `format` arguments, `format` is absent or `Auto_Detect`, the path's text changes, and exactly
 * one format type's patterns match it.
 */
export function formatTypeForPathUpdate(
  app: ArgumentApplication,
  update: WidgetUpdate,
): string | undefined {
  const args = [...app.iterApplications()].map((a) => a.argument)
  const path = args.find((a) => a.argInfo?.name === PATH_ARGUMENT)
  const format = args.find((a) => a.argInfo?.name === FORMAT_ARGUMENT)
  if (path == null || format == null) return undefined
  if (format instanceof ArgumentAst && !isAutoDetect(format.ast.code())) return undefined
  const before = path instanceof ArgumentAst ? pathTextOf(path.ast) : undefined
  const after = newPathText(path, update)
  if (after == null || after === before) return undefined
  return formatTypeForPath(after, format.dynamicConfig)
}

const rememberedFormatConfigs = new Map<string, WidgetConfiguration>()

/**
 * Remember the `format` options (with their libraries and patterns) that a `path`-and-`format`
 * call in the graph has loaded, per `owner` (the project's id), so that a dropped file can be matched
 * without asking the engine.
 */
export function rememberFormatConfig(owner: string, app: ArgumentApplication) {
  const args = [...app.iterApplications()].map((a) => a.argument)
  if (!args.some((a) => a.argInfo?.name === PATH_ARGUMENT)) return
  const config = args.find((a) => a.argInfo?.name === FORMAT_ARGUMENT)?.dynamicConfig
  if (
    config?.kind === 'Single_Choice' &&
    config.values.flatMap(flattenChoice).some((c) => c.requires)
  ) {
    rememberedFormatConfigs.set(owner, config)
  }
}

/**
 * The format type whose library reads a file dropped on the graph. Uses the options a call in the
 * graph has already loaded ({@link rememberFormatConfig}); only without them is `query` called
 * (it should itself give up quickly): it resolves to the engine's answer to
 * {@link DATA_READ_FORMAT_WIDGET_QUERY}. Any failure of the query gives `undefined`.
 */
export async function formatTypeForDrop(
  fileName: string,
  owner: string,
  query: () => Promise<unknown>,
): Promise<string | undefined> {
  const remembered = rememberedFormatConfigs.get(owner)
  if (remembered) return formatTypeForPath(fileName, remembered)
  try {
    return formatTypeForDroppedFile(fileName, await query())
  } catch (error) {
    console.info('Could not find the format library of a dropped file', error)
    return undefined
  }
}

/**
 * The expression that asks the engine for `Data.read`'s `format` widget configuration, as the
 * `format` argument's own query does (`widgetFunctionCallInfo.ts`), but without a node to hang it
 * on: a file dropped on the graph has none yet.
 */
export const DATA_READ_FORMAT_WIDGET_QUERY =
  'Standard.Visualization.Widgets.get_widget_json Standard.Base.Data .read ["format"] "{}"'

/**
 * The format type whose library reads a file dropped on the graph (which becomes
 * `Data.read '<name>'` with `format` on `Auto_Detect`): `widgetJson` is the answer to
 * {@link DATA_READ_FORMAT_WIDGET_QUERY}, matched as a `path` update is
 * ({@link formatTypeForPath}). `undefined` when the answer is unusable.
 */
export function formatTypeForDroppedFile(
  fileName: string,
  widgetJson: unknown,
): string | undefined {
  const parsed = argsWidgetConfigurationSchema.safeParse(widgetJson)
  if (!parsed.success) return undefined
  const format = parsed.data.find(([name]) => name === FORMAT_ARGUMENT)?.[1]
  return formatTypeForPath(fileName, format ?? undefined)
}
