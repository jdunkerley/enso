/** @file Expanding column picker references into the choice widgets the standard library built. */
/* eslint-disable camelcase -- the engine's field names */
import type {
  ArgsWidgetConfiguration,
  Choice,
  ColumnKind,
  ColumnNamePicker,
  ColumnPicker,
  OrderByPicker,
  SingleChoice,
  TextInput,
  WidgetColumns,
  WidgetConfiguration,
} from './configuration'

const PRETTY_ESCAPES: Record<string, string> = {
  '\\': '\\\\',
  "'": "\\'",
  '\n': '\\n',
  '\t': '\\t',
  '\0': '\\0',
  '\u0007': '\\a',
  '\b': '\\b',
  '\f': '\\f',
  '\r': '\\r',
  '\v': '\\v',
  '\u001b': '\\e',
}

/**
 * Enso's `Text.pretty` of a name: a single-quoted text literal. It escapes as
 * `Core_Text_Utils.prettyPrint` does (`lib/scala/common-polyglot-core-utils`): `\`, `'` and the
 * control characters `\n \t \0 \a \b \f \r \v \e`. Observed in Enso on Linux: `'F.G/H\I'.pretty` is
 * `'F.G/H\\I'`, `"it's".pretty` is `'it\'s'`, `'D "E"'.pretty` is `'D "E"'`, a tab is `\t`, a
 * newline `\n` and ESC `\e`.
 */
export function prettyText(name: string): string {
  let result = "'"
  for (const c of name) result += PRETTY_ESCAPES[c] ?? c
  return result + "'"
}

function option(label: string, value: string, parameters: ArgsWidgetConfiguration = []): Choice {
  return { label, value, parameters }
}

/** The names of `columns` which `kinds` admit: all if empty, else those of a listed kind or `Other`. */
function offeredNames(columns: WidgetColumns, kinds: readonly ColumnKind[]): string[] {
  if (kinds.length === 0) return columns.names
  return columns.names.filter((_, i) => {
    const kind = columns.kinds[i]
    return kind == null || kind === 'Other' || kinds.includes(kind)
  })
}

function expandColumnName(
  picker: ColumnNamePicker,
  columns: WidgetColumns | undefined,
): SingleChoice | TextInput {
  if (columns == null) {
    // The source is absent: only the picker's own choices, or free text.
    return picker.extra.length > 0 ?
        { kind: 'Single_Choice', values: picker.extra }
      : { kind: 'Text_Input' }
  }
  const first = columns.names[0]
  const expression =
    picker.expression && first != null ? [option('<Expression>', `(expr '[${first}]')`)] : []
  const names = offeredNames(columns, picker.kinds).map((name) =>
    option(name, picker.reference ? `(..Name ${prettyText(name)})` : prettyText(name)),
  )
  return {
    kind: 'Single_Choice',
    values:
      picker.columns_first ?
        [...names, ...picker.extra, ...expression]
      : [...picker.extra, ...expression, ...names],
  }
}

function plainColumnName(kinds: ColumnKind[], from: string | null): ColumnNamePicker {
  return {
    kind: 'Column_Name',
    kinds,
    from,
    expression: false,
    reference: false,
    extra: [],
    columns_first: false,
  }
}

function expandOrderBy(
  picker: OrderByPicker,
  columns: WidgetColumns | undefined,
): WidgetConfiguration {
  if (columns == null)
    return { kind: 'Vector_Editor', item_editor: { kind: 'Text_Input' }, item_default: "''" }
  const first = columns.names[0]
  const values =
    picker.name_only ?
      columns.names.map((name) => option(name, `(..Name ${prettyText(name)})`))
    : [
        option('Name', '..Name', [
          ['name', expandColumnName(plainColumnName([], picker.from), columns)],
        ]),
        option('Index', '..Index', [
          [
            'index',
            { kind: 'Numeric_Input', minimum: 0, maximum: Math.max(columns.names.length - 1, 0) },
          ],
        ]),
      ]
  return {
    kind: 'Vector_Editor',
    item_editor: { kind: 'Single_Choice', values },
    item_default: first != null ? `(..Name ${prettyText(first)})` : "''",
  }
}

/** The configuration a picker stands for, given its source's columns (`undefined`: the source is absent). */
export function expandPicker(
  picker: ColumnPicker,
  columns: WidgetColumns | undefined,
): WidgetConfiguration {
  switch (picker.kind) {
    case 'Column_Name':
      return expandColumnName(picker, columns)
    case 'Column_Names': {
      const flags = [
        ...(picker.regex ? [option('<Regular Expression>', 'regex')] : []),
        ...(picker.by_type ? [option('<By Type>', '(..By_Type ..Integer)')] : []),
      ]
      // An absent source with no flags offers nothing to choose from: free text (owner decision 13).
      if (!columns && flags.length === 0) return { kind: 'Text_Input' }
      const names =
        columns ? offeredNames(columns, picker.kinds).map((n) => option(n, prettyText(n))) : []
      return { kind: 'Multiple_Choice', values: [...flags, ...names] }
    }
    case 'Column_Vector': {
      const item = expandColumnName(plainColumnName(picker.kinds, picker.from), columns)
      const first = item.kind === 'Single_Choice' ? item.values[0]?.value : undefined
      return {
        kind: 'Vector_Editor',
        item_editor: item,
        item_default: typeof first === 'string' ? first : "''",
      }
    }
    case 'Order_By':
      return expandOrderBy(picker, columns)
  }
}

/** The expansions of pickers, kept per source schema so that an unchanged schema yields identical objects. */
export class SchemaCache {
  private readonly schemas = new Map<string, Map<string, WidgetConfiguration>>()

  /** @param maxSchemas how many schemas are kept; the least recently used one is dropped beyond. */
  constructor(private readonly maxSchemas = 64) {}

  /** The expansion of `pickerKey` for `schemaKey`, computed on first use. */
  get(
    schemaKey: string,
    pickerKey: string,
    compute: () => WidgetConfiguration,
  ): WidgetConfiguration {
    let expansions = this.schemas.get(schemaKey)
    if (expansions) this.schemas.delete(schemaKey)
    else expansions = new Map()
    this.schemas.set(schemaKey, expansions)
    if (this.schemas.size > this.maxSchemas) {
      const oldest = this.schemas.keys().next()
      if (!oldest.done) this.schemas.delete(oldest.value)
    }
    let expanded = expansions.get(pickerKey)
    if (expanded == null) {
      expanded = compute()
      expansions.set(pickerKey, expanded)
    }
    return expanded
  }
}

function isPicker(config: WidgetConfiguration): config is ColumnPicker {
  return (
    config.kind === 'Column_Name' ||
    config.kind === 'Column_Names' ||
    config.kind === 'Column_Vector' ||
    config.kind === 'Order_By'
  )
}

/** `array` with `f` applied to each element; the same array if no element changed. */
function mapPreserving<T>(array: T[], f: (item: T) => T): T[] {
  let changed = false
  const result = array.map((item) => {
    const mapped = f(item)
    if (mapped !== item) changed = true
    return mapped
  })
  return changed ? result : array
}

/**
 * `config` with every picker reference, at any depth, replaced by its expansion. Memoised per
 * (source schema, picker); `cache` is per opened project. Returns `config` itself if it holds no
 * picker.
 */
export function expandColumnPickers(
  config: WidgetConfiguration,
  columns: Readonly<Record<string, WidgetColumns>> | undefined,
  cache?: SchemaCache,
): WidgetConfiguration {
  const schemaKeys = new Map<string, string>()
  const schemaKeyOf = (from: string, source: WidgetColumns | undefined) => {
    if (!source) return 'absent'
    let key = schemaKeys.get(from)
    if (key == null) {
      key = JSON.stringify({ names: source.names, kinds: source.kinds })
      schemaKeys.set(from, key)
    }
    return key
  }
  return expandWith(config, columns, cache, schemaKeyOf)
}

function expandWith(
  config: WidgetConfiguration,
  columns: Readonly<Record<string, WidgetColumns>> | undefined,
  cache: SchemaCache | undefined,
  schemaKeyOf: (from: string, source: WidgetColumns | undefined) => string,
): WidgetConfiguration {
  const expandNested = (c: WidgetConfiguration) => expandWith(c, columns, cache, schemaKeyOf)
  const expandChoice = (choice: Choice): Choice => {
    const parameters = mapPreserving(choice.parameters, (arg) => {
      const [name, widget] = arg
      const expanded = widget && expandNested(widget)
      return expanded === widget ? arg : ([name, expanded] satisfies typeof arg)
    })
    const value =
      typeof choice.value === 'string' ? choice.value : mapPreserving(choice.value, expandChoice)
    return parameters === choice.parameters && value === choice.value ?
        choice
      : { ...choice, parameters, value }
  }
  if (isPicker(config)) {
    const from = config.from ?? ''
    const source = columns?.[from]
    const compute = () => expandNested(expandPicker(config, source))
    if (cache == null) return compute()
    return cache.get(schemaKeyOf(from, source), JSON.stringify(config), compute)
  }
  switch (config.kind) {
    case 'Single_Choice':
    case 'Multiple_Choice': {
      const values = mapPreserving(config.values, expandChoice)
      return values === config.values ? config : { ...config, values }
    }
    case 'Vector_Editor': {
      const itemEditor = expandNested(config.item_editor)
      return itemEditor === config.item_editor ? config : { ...config, item_editor: itemEditor }
    }
    default:
      return config
  }
}
