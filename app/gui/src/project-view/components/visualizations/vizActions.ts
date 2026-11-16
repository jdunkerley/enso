/**
 * @file The node actions Enso describes for a visualised value, and the builder that turns an
 * action's template and a gesture's values into a node pattern.
 */
import { Ast } from '@/util/ast'
import { Pattern } from '@/util/ast/match'
import { assertDefined } from 'ydoc-shared/util/assert'
import { z } from 'zod'

export const vizActionSchema = z.object({
  id: z.string(),
  label: z.string(),
  icon: z.string(),
  kind: z.enum(['chain', 'new_node']),
  template: z.string(),
})
export type VizAction = z.infer<typeof vizActionSchema>

/** The `actions` of a visualisation's message: none when it has none; a malformed entry is dropped. */
export function parseVizActions(data: unknown): VizAction[] {
  const message = z.object({ actions: z.array(z.unknown()) }).safeParse(data)
  if (!message.success) return []
  return message.data.actions.flatMap((item) => {
    const action = vizActionSchema.safeParse(item)
    return action.success ? [action.data] : []
  })
}

/** The action with `id`, if the value offers it. */
export function findAction(actions: readonly VizAction[], id: string): VizAction | undefined {
  return actions.find((action) => action.id === id)
}

export type ExpressionBuilder = (module: Ast.MutableModule) => Ast.Owned<Ast.MutableExpression>
export type ActionScalar = string | number | ExpressionBuilder
export type ActionValue = ActionScalar | readonly ActionScalar[]
export type ActionValues = Readonly<Record<string, ActionValue | null | undefined>>

interface Slot {
  name: string
  flag: '' | '#' | '@'
  many: boolean
}

const PLACEHOLDER = /\{\{([#@]?)(\w+)(\*?)\}\}/g
const NODE = 'node'

function parseTemplate(template: string): { code: string; slots: Slot[] } {
  const slots: Slot[] = []
  const code = template.replace(PLACEHOLDER, (_match, flag: string, name: string, star: string) => {
    slots.push({ name, flag: flag === '#' || flag === '@' ? flag : '', many: star === '*' })
    return '__'
  })
  return { code, slots }
}

const isNodeSlot = (slot: Slot) => slot.name === NODE && slot.flag === '' && !slot.many

/** The names of a template's placeholders, in order. */
export function placeholderNames(template: string): string[] {
  return parseTemplate(template).slots.map((slot) => slot.name)
}

function isScalarList(value: ActionValue): value is readonly ActionScalar[] {
  return Array.isArray(value)
}

type Fill = { node: true } | { node: false; slot: Slot; value: ActionValue }

/**
 * What goes into each of `slots`: the node for `{{node}}`, else the value named by the slot.
 * `undefined` when a value is missing, is a vector where one is not asked for (or the reverse),
 * or is an empty vector. Only values `values` owns count: `{{toString}}` is not `Object`'s.
 */
function fillsFor(slots: readonly Slot[], values: ActionValues): Fill[] | undefined {
  const fills: Fill[] = []
  for (const slot of slots) {
    if (isNodeSlot(slot)) {
      fills.push({ node: true })
      continue
    }
    const value = Object.hasOwn(values, slot.name) ? values[slot.name] : undefined
    if (value == null) return undefined
    if (isScalarList(value) ? !slot.many || value.length === 0 : slot.many) return undefined
    fills.push({ node: false, slot, value })
  }
  return fills
}

/** `value` in the plain decimal notation Enso reads: never `1e-7` or `1e+21`. */
function decimalNotation(value: number): string {
  const text = value.toString()
  const match = /^(-?)(\d)(?:\.(\d+))?e([+-])(\d+)$/.exec(text)
  if (!match) return text
  const [, sign, integer, fraction = '', exponentSign, exponent] = match
  const digits = integer + fraction
  return exponentSign === '-' ?
      `${sign}0.${'0'.repeat(Number(exponent) - 1)}${digits}`
    : sign + digits.padEnd(Number(exponent) + 1, '0')
}

/** An Enso number for `value`; `undefined` for `NaN` and the infinities, which Enso cannot write. */
function numberAst(value: number, module: Ast.MutableModule) {
  return Number.isFinite(value) ?
      Ast.NumericLiteral.tryParseWithSign(decimalNotation(value), module)
    : undefined
}

/**
 * One value as an Enso expression. A `''` flag reads text as code. `#` writes text that reads as
 * a number as that number, and `@` leaves it text; either writes a number as a number.
 * `undefined` when the value cannot be written.
 */
function scalarAst(value: ActionScalar, flag: Slot['flag'], module: Ast.MutableModule) {
  if (typeof value === 'function') return value(module)
  if (flag === '') {
    return typeof value === 'number' ? numberAst(value, module) : parseCode(value, module)
  }
  if (typeof value === 'number') return numberAst(value, module)
  const number = Number(value)
  return flag === '#' && !Number.isNaN(number) ?
      numberAst(number, module)
    : Ast.TextLiteral.new(value, module)
}

/** `code` as an expression; `undefined` when it is empty or not valid Enso. */
function parseCode(code: string, module: Ast.MutableModule) {
  const parsed = Ast.parseExpression(code, module)
  let invalid = false
  if (parsed)
    Ast.visitRecursive(parsed, (ast) => {
      if (ast instanceof Ast.Invalid) invalid = true
    })
  return invalid ? undefined : parsed
}

/** A vector for a `*` slot, else the one value; `undefined` when any of it cannot be written. */
function valueAst(value: ActionValue, slot: Slot, module: Ast.MutableModule) {
  return isScalarList(value) ?
      Ast.Vector.tryBuild(value, (element, m) => scalarAst(element, slot.flag, m), module)
    : scalarAst(value, slot.flag, module)
}

/**
 * A pattern of `code`, each `__` filled in order. `undefined` when `code` does not parse, a value
 * cannot be written, or the `__`s are not the places `fills` fills (a placeholder inside quotes,
 * `{{node}}` twice) — so a pattern that is returned can always be instantiated with one node.
 */
function fillPattern(code: string, fills: readonly Fill[]): Pattern | undefined {
  try {
    const template = Pattern.parseExpression(code)
    const pattern = Pattern.new<Ast.Expression>((node) => {
      const subtrees = fills.map((fill) =>
        fill.node ? node : valueAst(fill.value, fill.slot, node.module),
      )
      return template.instantiateCopied(
        subtrees.map((subtree) => {
          if (!subtree) throw new Error('A value cannot be written as Enso')
          return subtree
        }),
      )
    })
    const probe = Ast.Ident.tryParse('node')
    assertDefined(probe)
    pattern.instantiateCopied([probe])
    return pattern
  } catch {
    return undefined
  }
}

export type ChainStep = { template: string; values?: ActionValues } | { code: string }

/**
 * One node of `steps` applied to the visualised node in turn, joined by the spaced dot
 * (`node.get 'tags' . at 1`); `firstSpaced` spaces the first dot too (`node . filter …`), as the
 * table toolbar's filter node is written. A `code` step is used as it is (a tree's node
 * expression); a `template` step is filled as {@link actionPattern} fills a template.
 */
export function chainPattern(
  steps: readonly ChainStep[],
  options: { firstSpaced?: boolean } = {},
): Pattern | undefined {
  if (steps.length === 0) return undefined
  const parts: string[] = []
  const fills: Fill[] = [{ node: true }]
  for (const step of steps) {
    if ('code' in step) {
      parts.push(step.code)
      continue
    }
    const { code, slots } = parseTemplate(step.template)
    if (slots.some((slot) => slot.name === NODE)) return undefined
    const stepFills = fillsFor(slots, step.values ?? {})
    if (!stepFills) return undefined
    parts.push(code)
    fills.push(...stepFills)
  }
  const [first, ...rest] = parts
  const code =
    '__' + (options.firstSpaced ? ' . ' : '.') + first + rest.map((part) => ' . ' + part).join('')
  return fillPattern(code, fills)
}

/**
 * The node of one action, filled from `values`. `undefined` when the action cannot make a node
 * from them, never a throw: a value is missing, empty or not writable as Enso, or the template is
 * not a valid one.
 *
 * Placeholders: `{{#x}}` is the value of `x`, a number when it reads as one and else text;
 * `{{\@x}}` the value as it is (a number stays a number, anything else is text); `{{x}}` an Enso
 * expression (a string of code, or a builder); a `*` after the name, a non-empty vector of such
 * values. A `new_node` template has to hold `{{node}}` once, the visualised node; a `chain` one
 * continues from it.
 */
export function actionPattern(
  action: Pick<VizAction, 'kind' | 'template'>,
  values: ActionValues = {},
): Pattern | undefined {
  if (action.kind === 'chain') return chainPattern([{ template: action.template, values }])
  const { code, slots } = parseTemplate(action.template)
  if (!slots.some(isNodeSlot)) return undefined
  const fills = fillsFor(slots, values)
  return fills && fillPattern(code, fills)
}

/** Whether an action needs no gesture: a chain without placeholders, a new node with only `{{node}}`. */
export function isPlainAction(action: VizAction): boolean {
  const { slots } = parseTemplate(action.template)
  return action.kind === 'chain' ? slots.length === 0 : slots.length > 0 && slots.every(isNodeSlot)
}
