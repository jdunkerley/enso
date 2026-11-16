/**
 * @file The node actions Enso describes for a visualised value (`Standard.Visualization.Viz_Actions`,
 * the `actions` field of a visualisation's message), and the one builder that turns an action's
 * template and a gesture's values into a node pattern. A visualisation owns its gestures and fills
 * in the values a template names; it never writes an Enso method name.
 *
 * Templates: `{{#x}}` the value of `x`, a number when it reads as one, else text; an `@` placeholder, the
 * value as it is (a number stays a number, anything else is text); `{{x}}` an Enso expression the
 * gesture builds; a `*` after the name, a vector of such values; `{{node}}` the visualised node, in
 * a `new_node` template only. A missing value gives no pattern, never a broken node.
 */
import { Ast } from '@/util/ast'
import { Pattern } from '@/util/ast/match'
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
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return []
  const list = z.array(z.unknown()).safeParse((data as { actions?: unknown }).actions)
  if (!list.success) return []
  return list.data.flatMap((item) => {
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
    slots.push({ name, flag: flag as Slot['flag'], many: star === '*' })
    return '__'
  })
  return { code, slots }
}

const isNodeSlot = (slot: Slot) => slot.name === NODE && slot.flag === '' && !slot.many

/** The names of a template's placeholders, in order. */
export function placeholderNames(template: string): string[] {
  return parseTemplate(template).slots.map((slot) => slot.name)
}

/** Whether a template's values are all there, each a vector exactly where `*` asks for one. */
function filled(slots: readonly Slot[], values: ActionValues): boolean {
  return slots.every((slot) => {
    if (isNodeSlot(slot)) return true
    const value = values[slot.name]
    return value != null && Array.isArray(value) === slot.many
  })
}

function scalarAst(
  value: ActionScalar,
  flag: Slot['flag'],
  module: Ast.MutableModule,
): Ast.Owned<Ast.MutableExpression> {
  if (typeof value === 'function') return value(module)
  if (flag === '') {
    return typeof value === 'number' ?
        Ast.tryNumberToEnso(value, module)!
      : Ast.parseExpression(value, module)!
  }
  const cast = flag === '#' && !isNaN(Number(value)) ? Number(value) : value
  return typeof cast === 'number' && !isNaN(cast) ?
      Ast.tryNumberToEnso(cast, module)!
    : Ast.TextLiteral.new(String(cast), module)
}

function valueAst(
  value: ActionValue,
  slot: Slot,
  module: Ast.MutableModule,
): Ast.Owned<Ast.MutableExpression> {
  if (Array.isArray(value)) {
    return Ast.Vector.build(
      value as readonly ActionScalar[],
      (element, elementModule) => scalarAst(element, slot.flag, elementModule),
      module,
    )
  }
  return scalarAst(value as ActionScalar, slot.flag, module)
}

type Fill = { node: true } | { node: false; slot: Slot; value: ActionValue }

/** A pattern of `code`, each `__` filled in order: the node where `fill.node`, else the value. */
function fillPattern(code: string, fills: readonly Fill[]): Pattern | undefined {
  let template: Pattern
  try {
    template = Pattern.parseExpression(code)
  } catch {
    return undefined
  }
  return Pattern.new<Ast.Expression>((ast) =>
    template.instantiateCopied(
      fills.map((fill) => (fill.node ? ast : valueAst(fill.value, fill.slot, ast.module))),
    ),
  )
}

export type ChainStep = { template: string; values?: ActionValues } | { code: string }

/**
 * One node of `steps` applied to the visualised node in turn, joined by the spaced dot
 * (`node.get 'tags' . at 1`); `firstSpaced` spaces the first dot too (`node . filter …`), as the
 * table toolbar's filter node is written. A `code` step is used as it is (a tree's node
 * expression); a `template` step is filled from its values.
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
    const values = step.values ?? {}
    if (slots.some((slot) => slot.name === NODE) || !filled(slots, values)) return undefined
    parts.push(code)
    for (const slot of slots) fills.push({ node: false, slot, value: values[slot.name]! })
  }
  const [first, ...rest] = parts
  const code =
    '__' + (options.firstSpaced ? ' . ' : '.') + first + rest.map((part) => ' . ' + part).join('')
  return fillPattern(code, fills)
}

/** The node of one action, filled from `values`; `undefined` when a value it needs is missing. */
export function actionPattern(
  action: Pick<VizAction, 'kind' | 'template'>,
  values: ActionValues = {},
): Pattern | undefined {
  if (action.kind === 'chain') return chainPattern([{ template: action.template, values }])
  const { code, slots } = parseTemplate(action.template)
  if (!slots.some(isNodeSlot) || !filled(slots, values)) return undefined
  return fillPattern(
    code,
    slots.map((slot) =>
      isNodeSlot(slot) ? { node: true } : { node: false, slot, value: values[slot.name]! },
    ),
  )
}

/** Whether an action needs no gesture: a chain without placeholders, a new node with only `{{node}}`. */
export function isPlainAction(action: VizAction): boolean {
  const { slots } = parseTemplate(action.template)
  return action.kind === 'chain' ? slots.length === 0 : slots.length > 0 && slots.every(isNodeSlot)
}
