/** @file A widget configuration that is a type's default, as `TypeDefaults.lookup` returns it. */
import type { WidgetConfiguration } from '$/providers/openedProjects/widgetRegistry/configuration'
import { TypeDefaults } from '$/providers/openedProjects/widgetRegistry/typeDefaults'
import { flushPromises } from '@vue/test-utils'
import { Ok } from 'enso-common/src/utilities/data/result'
import type { ExternalId } from 'ydoc-shared/yjsModel'

const FRAME = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' as ExternalId

/** The default widget of a type whose answer is `kind`. */
export async function typeDefaultConfig(kind: string): Promise<WidgetConfiguration> {
  const defaults = new TypeDefaults(
    () => true,
    async () => Ok({ widget: { constructor: kind } }),
    (frame) => frame,
    'project',
  )
  defaults.lookup('T', FRAME)
  await flushPromises()
  const config = defaults.lookup('T', FRAME)
  defaults.dispose()
  if (config == null) throw new Error(`No type default of kind ${kind}`)
  return config
}
