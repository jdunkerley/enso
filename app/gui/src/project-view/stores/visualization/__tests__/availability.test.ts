import { SuggestionDb } from '$/providers/openedProjects/suggestionDatabase'
import {
  makeArgument,
  makeMethod,
} from '$/providers/openedProjects/suggestionDatabase/mockSuggestion'
import * as geoMapVisualization from '@/components/visualizations/GeoMapVisualization.vue'
import * as scatterplotVisualization from '@/components/visualizations/ScatterplotVisualization.vue'
import * as sqlVisualization from '@/components/visualizations/SQLVisualization.vue'
import * as tableVisualization from '@/components/visualizations/TableVisualization.vue'
import {
  fromVisualizationId,
  toVisualizationId,
  VisualizationMetadataDb,
  visualizationsForTypes,
} from '@/stores/visualization/metadata'
import { parseAbsoluteProjectPathRaw } from '@/util/projectPath'
import { assert, expect, test } from 'vitest'

const VIZ_TABLE = 'Standard.Visualization.Viz_Table.Viz_Table'

function conversionFrom(source: string) {
  return makeMethod(`${VIZ_TABLE}.from`, { args: [makeArgument('that', source)] })
}

// The suggestion database as the language server reports it.
const suggestionDb = SuggestionDb.createMock([
  conversionFrom('Standard.Table.Table.Table'),
  conversionFrom('Standard.Base.Data.Vector.Vector'),
  conversionFrom('Standard.Base.Data.Numbers.Number'),
  conversionFrom('Standard.Base.Any.Any'),
])

// The builtin visualizations, registered as the visualization store does.
const metadata = new VisualizationMetadataDb()
for (const { name, inputType, dataType, icon } of [
  tableVisualization,
  scatterplotVisualization,
  sqlVisualization,
  geoMapVisualization,
]) {
  metadata.set(toVisualizationId({ module: { kind: 'Builtin' }, name }), {
    name,
    inputType,
    dataType,
    icon,
  })
}

/** The names of the visualizations offered for values having the given types. */
function offered(...types: string[]): string[] {
  const keys = types.map((type) => {
    const parsed = parseAbsoluteProjectPathRaw(type)
    assert(parsed.ok)
    return parsed.value.key()
  })
  return visualizationsForTypes(metadata, keys, (target) =>
    suggestionDb.conversionSources.lookup(target),
  )
    .map((id) => fromVisualizationId(id).name)
    .sort()
}

test('a Table is offered every chart, and its Table view', () => {
  expect(offered('Standard.Table.Table.Table')).toEqual(['Geo Map', 'Scatter Plot', 'Table'])
})

test('a Vector and a Number, which convert to the data type, are offered the charts', () => {
  expect(offered('Standard.Base.Data.Vector.Vector')).toEqual(['Geo Map', 'Scatter Plot', 'Table'])
  expect(offered('Standard.Base.Data.Numbers.Number')).toEqual(['Geo Map', 'Scatter Plot', 'Table'])
})

test('a value with only the `Any` conversion is not offered the charts', () => {
  expect(offered('Standard.Base.Data.Text.Text')).toEqual(['Table'])
  expect(offered('Standard.Base.Any.Any')).toEqual(['Table'])
})

test('the SQL view stays bound to its static input type', () => {
  expect(offered('Standard.Database.DB_Table.DB_Table')).toEqual(['SQL Query', 'Table'])
  expect(offered('Standard.Table.Table.Table')).not.toContain('SQL Query')
})
