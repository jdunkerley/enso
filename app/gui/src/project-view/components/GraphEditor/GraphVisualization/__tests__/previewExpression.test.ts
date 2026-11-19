import { previewExpression } from '@/components/GraphEditor/GraphVisualization/previewExpression'
import { expect, test } from 'vitest'

test('the preview applies the preprocessor to the typed expression through Standard.Base', () => {
  expect(
    previewExpression(
      {
        visualizationModule: 'Standard.Visualization.Table.Visualization',
        expression: 'prepare_visualization',
        positionalArgumentsExpressions: ['1000'],
      },
      'data.filter 1',
    ),
  ).toBe(
    "Standard.Base.Meta.call_module_method 'Standard.Visualization.Table.Visualization' 'prepare_visualization' [1000] _ <| data.filter 1",
  )
})
