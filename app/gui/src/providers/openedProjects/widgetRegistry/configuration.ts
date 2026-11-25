import { z } from 'zod'
import { expandColumnPickers, type SchemaCache } from './columnPickers'

/**
 * Intermediate step in the parsing process, when we rename `constructor` field to `kind`.
 *
 * It helps to avoid issues with TypeScript, which considers `constructor` as a reserved keyword in many contexts.
 */
const inputSchema = z
  .object({
    constructor: z.string(),
  })
  .passthrough()
type Input = z.infer<typeof inputSchema>
type WithoutConstructor = Omit<Input, 'constructor'>
type WithKind = WithoutConstructor & { kind: string }
const withKindSchema: z.ZodType<WithKind, z.ZodTypeDef, Input> = inputSchema.transform((value) => {
  const kind = value['constructor'] as string
  return { kind, ...structuredClone(value) }
})

const choiceValueSchema = z.lazy(() => z.union([z.string(), z.array(choiceSchema)]))
export type ChoiceValue = z.infer<typeof choiceValueSchema>

/** A choosable item in SingleChoice and MultipleChoice widgets. */
const choiceSchema: z.ZodType<Choice> = z.object({
  value: choiceValueSchema,
  label: z.string().nullable(),
  parameters: z.lazy(() => z.array(argumentSchema)),
  icon: z.string().nullable().optional(),
  requires: z.string().optional(),
  patterns: z.array(z.string()).optional(),
})
/**
 * `requires` is the fully qualified name of a type whose library the choice needs: picking the
 * choice adds that library's import. `patterns` are the file name patterns (`*.db`) of the files
 * the choice reads: with format on `Auto_Detect`, a path that only one type's patterns match adds
 * its import (`WidgetFunction/formatForPath.ts`). `detail` is set by the GUI only, never parsed:
 * a quiet note the dropdown shows beside the label (a column picker's option has the column's
 * type, `columnPickers.ts`).
 */
export type Choice = {
  value: ChoiceValue
  label: string | null
  parameters: ArgsWidgetConfiguration
  icon?: string | null | undefined
  requires?: string | undefined
  patterns?: string[] | undefined
  detail?: string | undefined
}
export type FlattenedChoice = {
  value: string
  label: string | null
  parameters: ArgsWidgetConfiguration
  icon?: string | null | undefined
  requires?: string | undefined
  patterns?: string[] | undefined
}

const fileTypeSchema: z.ZodType<FileType> = z.object({
  label: z.string(),
  extensions: z.lazy(() => z.union([z.array(z.string()), z.array(fileTypeSchema)])),
  icon: z.string().nullable().optional(),
})

export type FileType = {
  label: string
  extensions: string[] | FileType[]
  icon?: string | null | undefined
}

/** Whether FileType[] contains nested FileType objects. */
export function isFileTypes(array: (FileType | string)[]): array is FileType[] {
  return array.length == 0 || typeof array[0]! === 'object'
}

/** Whether FileType[] contains only string values. */
export function isExtensions(array: (FileType | string)[]): array is string[] {
  return array.length == 0 || typeof array[0]! === 'string'
}

/** Whether FileType[] contains a single '*' value, indicating that all files are allowed. */
export function isGlobAll(array: (FileType | string)[]): boolean {
  return array.length === 1 && array[0]! === '*'
}

/**
 * An external configuration for a widget retreived from the language server.
 *
 * The expected configuration type is defined as Enso type `Widget` in the following file:
 * distribution/lib/Standard/Base/0.0.0-dev/src/Metadata.enso
 *
 * To avoid ruining forward compatibility, only fields that are used by the IDE are defined here.
 */
// Defining widget definition type explicitly is necessary because of recursive structure
// of some variants, like VectorEditor. Zod can’t handle type inference by itself.
export type WidgetConfiguration =
  | SingleChoice
  | VectorEditor
  | MultipleChoice
  | BooleanInput
  | NumericInput
  | TextInput
  | FolderBrowse
  | FileBrowse
  | DateInput
  | DateTimeInput
  | TimeInput
  | SecretBrowse
  | AnyToTarget
  | RegexInput
  | UnionConfig
  | FunctionCall
  | OneOfFunctionCalls
  | SomeOfFunctionCalls
  | ColumnPicker
  | PendingConfiguration

/**
 * Sometimes it takes time to receive the configuration, but we still want to know that it is expected.
 * This configuration is not provided by the engine directly, but is derived from existing argument annotations.
 */
export interface PendingConfiguration {
  kind: 'Pending'
}

/** Helper for creating a pending configuration record. */
export function pending(): WidgetConfiguration {
  return { kind: 'Pending' }
}

/** The kind of a table column, as the engine's `Widget.Column_Kind` classifies it. */
export type ColumnKind =
  'Numeric' | 'Textual' | 'Logical' | 'Date_Only' | 'Date_And_Time' | 'Time_Only' | 'Other'

/** The columns of one source (the call's subject, or an argument), sent once per answer. */
export interface WidgetColumns {
  names: string[]
  kinds: ColumnKind[]
  type_names: string[]
}

/**
 * A reference to a column picker, which the engine sends instead of the choices themselves. The
 * IDE expands it (`columnPickers.ts`) from the answer's {@link WidgetColumns}; `from` names the
 * source (`null`: the call's subject).
 */
export interface ColumnNamePicker {
  kind: 'Column_Name'
  kinds: ColumnKind[]
  from: string | null
  expression: boolean
  reference: boolean
  extra: Choice[]
  columns_first: boolean
}

export interface ColumnNamesPicker {
  kind: 'Column_Names'
  kinds: ColumnKind[]
  from: string | null
  regex: boolean
  by_type: boolean
}

export interface ColumnVectorPicker {
  kind: 'Column_Vector'
  kinds: ColumnKind[]
  from: string | null
}

export interface OrderByPicker {
  kind: 'Order_By'
  from: string | null
  name_only: boolean
}

export type ColumnPicker = ColumnNamePicker | ColumnNamesPicker | ColumnVectorPicker | OrderByPicker

export interface VectorEditor {
  kind: 'Vector_Editor'
  item_editor: WidgetConfiguration
  item_default: string
}

export interface MultipleChoice {
  kind: 'Multiple_Choice'
  values: Choice[]
}

export interface BooleanInput {
  kind: 'Boolean_Input'
}

export interface NumericInput {
  kind: 'Numeric_Input'
  maximum?: number | undefined
  minimum?: number | undefined
}

export interface TextInput {
  kind: 'Text_Input'
  syntax?: string | undefined
}

export interface FolderBrowse {
  kind: 'Folder_Browse'
}

export interface FileBrowse {
  kind: 'File_Browse'
  existing_only?: boolean | undefined
  action?: 'Open' | 'Save' | undefined
  file_types?: FileType[] | undefined
}

export interface DateInput {
  kind: 'Date_Input'
}

export interface DateTimeInput {
  kind: 'Date_Time_Input'
}

export interface TimeInput {
  kind: 'Time_Input'
}

export interface SecretBrowse {
  kind: 'Secret_Browse'
}

export interface SingleChoice {
  kind: 'Single_Choice'
  values: Choice[]
}

export interface AnyToTarget {
  kind: 'Any_To_Target'
}

export interface RegexInput {
  kind: 'Regex_Input'
}

/** One kind of a union: its label and the widget of a value of that kind (`null`: `Nothing`). */
export interface UnionKind {
  label: string
  config: WidgetConfiguration | null
}

export interface UnionConfig {
  kind: 'Union'
  /** In picker order; `Nothing`, when included, is the last entry with `config: null`. */
  kinds: UnionKind[]
}

/**
 * Dynamic configuration for a function call with a list of arguments with known dynamic configuration.
 * This kind of config is not provided by the engine directly, but is derived from other config types by widgets.
 */
export interface FunctionCall {
  kind: 'FunctionCall'
  parameters: Map<string, WidgetConfiguration | null>
  /** Why the engine has no widget for these arguments (`Widget_Query.resolve_call`'s errors). */
  errors?: Map<string, WidgetQueryError> | undefined
  /** The arguments whose widget a resolver computes, with what it reads; absent when none. */
  resolvers?: Map<string, ResolverInfo> | undefined
  /** Why an argument shows its fallback rather than its widget; absent when none. */
  notes?: Map<string, WidgetQueryNote> | undefined
  /**
   * Called with the text typed in a searchable argument's dropdown (`''` when it closes), when
   * some argument is searchable: the engine is asked again with that text.
   */
  onSearch?: ((argument: string, text: string) => void) | undefined
}

/**
 * Dynamic configuration for one of the possible function calls. It is typically the case for dropdown widget.
 * One of function calls will be chosen by WidgetFunction basing on the actual AST at the call site,
 * and the configuration will be used in child widgets.
 * This kind of config is not provided by the engine directly, but is derived from other config types by widgets.
 */
export interface OneOfFunctionCalls {
  kind: 'OneOfFunctionCalls'
  /**
   * A list of possible function calls and their corresponding configuration.
   * The key is typically a fully qualified or autoscoped name of the function, but in general it can be anything,
   * depending on the widget implementation.
   */
  possibleFunctions: Map<string, FunctionCall>
}

export interface SomeOfFunctionCalls {
  kind: 'SomeOfFunctionCalls'
  possibleFunctions: Map<string, FunctionCall>
}

const columnKindSchema = z.enum([
  'Numeric',
  'Textual',
  'Logical',
  'Date_Only',
  'Date_And_Time',
  'Time_Only',
  'Other',
])

const widgetColumnsSchema = z.object({
  names: z.array(z.string()),
  kinds: z.array(columnKindSchema),
  // eslint-disable-next-line camelcase
  type_names: z.array(z.string()),
})

/** The engine's `Widget.Union`: `kinds` as `[label, widget]` pairs and `include_nothing`. */
interface RawUnion {
  kind: 'Union'
  kinds: [string, WidgetConfiguration][]
  include_nothing?: boolean | undefined
}

function toUnionConfig({ kinds, include_nothing: includeNothing }: RawUnion): UnionConfig {
  return {
    kind: 'Union',
    kinds: [
      ...kinds.map(([label, config]): UnionKind => ({ label, config })),
      ...(includeNothing ? [{ label: 'Nothing', config: null }] : []),
    ],
  }
}

export const widgetConfigurationSchema: z.ZodType<WidgetConfiguration, z.ZodTypeDef, any> =
  withKindSchema
    .pipe(
      /* eslint-disable camelcase */
      z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('Single_Choice'), values: z.array(choiceSchema) }),
        z.object({
          kind: z.literal('Vector_Editor'),
          item_editor: z.lazy(() => widgetConfigurationSchema),
          item_default: z.string(),
        }),
        z.object({ kind: z.literal('Multiple_Choice'), values: z.array(choiceSchema) }),
        z.object({ kind: z.literal('Boolean_Input') }),
        z.object({
          kind: z.literal('Numeric_Input'),
          maximum: z.number().optional(),
          minimum: z.number().optional(),
        }),
        z.object({ kind: z.literal('Text_Input'), syntax: z.string().optional() }),
        z.object({ kind: z.literal('Folder_Browse') }),
        z.object({
          kind: z.literal('File_Browse'),
          existing_only: z.boolean().optional(),
          action: z.enum(['Open', 'Save']).optional(),
          file_types: z.array(fileTypeSchema),
        }),
        z.object({ kind: z.literal('Date_Input') }),
        z.object({ kind: z.literal('Date_Time_Input') }),
        z.object({ kind: z.literal('Time_Input') }),
        z.object({ kind: z.literal('Secret_Browse') }),
        z.object({ kind: z.literal('Any_To_Target') }),
        z.object({ kind: z.literal('Regex_Input') }),
        z.object({
          kind: z.literal('Union'),
          kinds: z.array(z.tuple([z.string(), z.lazy(() => widgetConfigurationSchema)])),
          include_nothing: z.boolean().optional(),
        }),
        z.object({
          kind: z.literal('Column_Name'),
          kinds: z.array(columnKindSchema),
          from: z.string().nullable(),
          expression: z.boolean(),
          reference: z.boolean(),
          extra: z.array(choiceSchema),
          columns_first: z.boolean(),
        }),
        z.object({
          kind: z.literal('Column_Names'),
          kinds: z.array(columnKindSchema),
          from: z.string().nullable(),
          regex: z.boolean(),
          by_type: z.boolean(),
        }),
        z.object({
          kind: z.literal('Column_Vector'),
          kinds: z.array(columnKindSchema),
          from: z.string().nullable(),
        }),
        z.object({
          kind: z.literal('Order_By'),
          from: z.string().nullable(),
          name_only: z.boolean(),
        }),
        /* eslint-enable camelcase */
      ]),
    )
    .transform((config): WidgetConfiguration =>
      config.kind === 'Union' ? toUnionConfig(config as RawUnion) : (config as WidgetConfiguration),
    )

const argNameSchema = z.string()
const argumentSchema = z.tuple([argNameSchema, widgetConfigurationSchema.nullable()])
export type ArgumentWidgetConfiguration = z.infer<typeof argumentSchema>

export const argsWidgetConfigurationSchema = z.array(argumentSchema)
export type ArgsWidgetConfiguration = z.infer<typeof argsWidgetConfigurationSchema>

/** Why the engine could not resolve an argument's widget (Enso `Widget_Failure.to_json`). */
export const widgetQueryErrorSchema = z.object({
  step: z.string(),
  message: z.string(),
})
export type WidgetQueryError = z.infer<typeof widgetQueryErrorSchema>

/**
 * A widget computed per call by a resolver: the call's parts it reads (`'self'`, first, for the
 * call's subject; otherwise names of the method's arguments) and whether it takes the text typed
 * in the argument's dropdown (`search`).
 */
export const resolverInfoSchema = z.object({
  dependencies: z.array(z.string()),
  searchable: z.boolean(),
})
export type ResolverInfo = z.infer<typeof resolverInfoSchema>

/** A resolver not run because one of its dependencies is an error. */
const unavailableSchema = z.object({ dependency: z.string(), message: z.string() })

/**
 * Why an argument shows its fallback (the type default, or no widget) rather than its widget:
 * a dependency of its resolver is an error, or the resolver has not answered in
 * `RESOLVER_TIME_BOX_MS`.
 */
export type WidgetQueryNote =
  { kind: 'unavailable'; dependency: string; message: string } | { kind: 'loading' }

const argumentResultSchema = z.union([
  z.object({
    widget: widgetConfigurationSchema.nullable(),
    resolver: resolverInfoSchema.optional(),
    unavailable: unavailableSchema.optional(),
  }),
  z.object({ error: widgetQueryErrorSchema, resolver: resolverInfoSchema.optional() }),
])

/**
 * The answer of `Standard.Base.Metadata.Widget_Query.resolve_call`: for each argument asked
 * for, in order, its widget (`null`: none) or why it has none. `columns` lists the columns once per
 * source, which column picker references in the widgets point at (key `''`: the call's subject).
 *
 * An argument whose widget a resolver computes carries `resolver` (what the resolver reads); when
 * one of those is an error, the widget is `null` and `unavailable` names it. `search` and
 * `revision` echo the query's own, when it sent them, so a stale answer can be told apart.
 */
export const widgetQueryAnswerSchema = z.object({
  arguments: z.array(z.tuple([argNameSchema, argumentResultSchema])),
  columns: z.record(z.string(), widgetColumnsSchema).optional(),
  search: z.string().optional(),
  revision: z.string().optional(),
})
export type WidgetQueryAnswer = z.infer<typeof widgetQueryAnswerSchema>

/**
 * {@link functionCallConfiguration} of an answer: its widgets as parameters, its errors, its
 * resolvers and its notes apart (each only when there is one). An argument with a note has no
 * widget, so the call tree falls back to its type default. Column picker references are expanded from the answer's columns (through `cache`, if given).
 */
export function functionCallFromAnswer(
  answer: WidgetQueryAnswer,
  inherited?: FunctionCall,
  cache?: SchemaCache,
): FunctionCall {
  const parameters: ArgumentWidgetConfiguration[] = []
  const errors = new Map<string, WidgetQueryError>()
  const resolvers = new Map<string, ResolverInfo>()
  const notes = new Map<string, WidgetQueryNote>()
  for (const [name, result] of answer.arguments) {
    if (result.resolver) resolvers.set(name, result.resolver)
    if ('error' in result) errors.set(name, result.error)
    else {
      if (result.unavailable) notes.set(name, { kind: 'unavailable', ...result.unavailable })
      parameters.push([
        name,
        result.widget && expandColumnPickers(result.widget, answer.columns, cache),
      ])
    }
  }
  const call: FunctionCall = functionCallConfiguration(parameters, inherited)
  if (errors.size > 0) call.errors = errors
  if (resolvers.size > 0) call.resolvers = resolvers
  if (notes.size > 0) call.notes = notes
  return call
}

/**
 * Create {@link WidgetConfiguration} object from parameters received from the engine, possibly
 * applying those to an inherited config received from parent widget.
 *
 * Inherited config has a priority, as we expect parent widget has more information available
 * and can provide better configuration for its children.
 */
export function functionCallConfiguration(
  parameters: ArgumentWidgetConfiguration[],
  inherited?: FunctionCall,
): FunctionCall {
  const parametersMap = new Map(inherited?.parameters)
  for (const [name, param] of parameters) {
    // Merge with inherited parameters, inherited ones have priority.
    if (param && !parametersMap.has(name)) parametersMap.set(name, param)
  }
  return {
    kind: 'FunctionCall',
    parameters: parametersMap,
  }
}

/** Flatten possibly nested choice. */
export function flattenChoice(choice: Choice): FlattenedChoice[] {
  if (typeof choice.value === 'string') {
    return [choice as FlattenedChoice]
  }
  return choice.value.flatMap(flattenChoice)
}

/** A configuration for the inner widget of a single-choice selection widget. */
export function singleChoiceConfiguration(config: SingleChoice): OneOfFunctionCalls {
  const possibleChoices = config.values.flatMap(flattenChoice)
  return {
    kind: 'OneOfFunctionCalls',
    possibleFunctions: new Map(
      possibleChoices.map((choice) => [choice.value, functionCallConfiguration(choice.parameters)]),
    ),
  }
}

/** A configuration for the inner widget of a multiple-choice selection widget. */
export function multipleChoiceConfiguration(config: MultipleChoice): SomeOfFunctionCalls {
  const possibleChoices = config.values.flatMap(flattenChoice)
  return {
    kind: 'SomeOfFunctionCalls',
    possibleFunctions: new Map(
      possibleChoices.map((choice) => [choice.value, functionCallConfiguration(choice.parameters)]),
    ),
  }
}
