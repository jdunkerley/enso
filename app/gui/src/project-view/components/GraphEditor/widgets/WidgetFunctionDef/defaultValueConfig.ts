/** @file The widget configuration of an argument's default value in the signature editor. */
import type { WidgetConfiguration } from '$/providers/openedProjects/widgetRegistry/configuration'
import type { TypeDefaults } from '$/providers/openedProjects/widgetRegistry/typeDefaults'
import type { ExternalId } from 'ydoc-shared/yjsModel'

/**
 * The default widget of the argument's declared type, asked in `frame`. Without a frame there is
 * nowhere to ask, so nothing is looked up and the value has no configuration.
 */
export function defaultValueConfig(
  typeDefaults: Pick<TypeDefaults, 'lookup'>,
  expectedType: string | undefined,
  frame: ExternalId | undefined,
): WidgetConfiguration | undefined {
  return frame != null ? typeDefaults.lookup(expectedType, frame) : undefined
}
