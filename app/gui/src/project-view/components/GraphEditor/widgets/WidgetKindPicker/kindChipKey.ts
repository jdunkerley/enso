/** @file The kind picker's chip, as handed to the widget that draws it after the argument's name. */
import type { UnionKind } from '$/providers/openedProjects/widgetRegistry/configuration'

/** What the chip shows (`kinds[chosenIndex]`, the kind the value is) and how a choice is written. */
export interface KindChipProps {
  kinds: readonly UnionKind[]
  chosenIndex: number
  switchTo: (kind: UnionKind) => void
}

/**
 * The chip the kind picker hands down to `WidgetArgumentName`, which draws it between the
 * argument's name and its value, so the icon stands directly in front of the value.
 */
export const KindChipKey: unique symbol = Symbol.for('WidgetInput:KindChip')

/** Whether the chip stands in for the value: `Nothing` chosen, on a selected node (the `Nothing ▼` button). */
export function chipReplacesValue(chip: KindChipProps, selected: boolean): boolean {
  return selected && chip.kinds[chip.chosenIndex]?.config === null
}

declare module '$/providers/openedProjects/widgetRegistry' {
  export interface WidgetInput {
    [KindChipKey]?: KindChipProps | undefined
  }
}
