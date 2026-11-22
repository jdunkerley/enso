/** @file A widget query note, as handed to the widget that draws it after the argument's name. */
import type { WidgetQueryNote } from '$/providers/openedProjects/widgetRegistry/configuration'

/**
 * The note `WidgetQueryNote` hands down to `WidgetArgumentName`, which draws its marker between
 * the argument's name and its value: inside the argument's chip, so the marker reads as part of
 * that argument (as the kind picker's chip does, `KindChipKey`).
 */
export const NoteAfterNameKey: unique symbol = Symbol.for('WidgetInput:NoteAfterName')

declare module '$/providers/openedProjects/widgetRegistry' {
  export interface WidgetInput {
    [NoteAfterNameKey]?: WidgetQueryNote | undefined
  }
}
