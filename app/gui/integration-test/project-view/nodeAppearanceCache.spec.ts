import { expect, test } from 'integration-test/base'
import { mockExpressionUpdate } from './expressionUpdates'
import * as locate from './locate'

async function nodeColor(node: ReturnType<typeof locate.graphNodeByBinding>) {
  const style = (await node.getAttribute('style')) ?? ''
  return /--node-group-color:\s*([^;]+)/.exec(style)?.[1]?.trim()
}

test('a pending node shows the colour cached from its last computation', async ({
  editorPage,
  page,
}) => {
  await editorPage
  const five = locate.graphNodeByBinding(page, 'five')
  const ten = locate.graphNodeByBinding(page, 'ten')

  // Never computed: pending, no-type colour.
  await expect(ten).toHaveClass(/pending/)
  expect(await nodeColor(ten)).toBe('var(--node-color-no-type)')

  // Computed with a type: gets the type's colour, which is then cached.
  await mockExpressionUpdate(page, 'five', {
    type: ['Standard.Base.Data.Numbers.Integer'],
  })
  await expect(five).not.toHaveClass(/pending/)
  const computedColor = await nodeColor(five)
  expect(computedColor).toBeDefined()
  expect(computedColor).not.toBe('var(--node-color-no-type)')

  // Pending again with no type info: the cached colour is shown, faded by `.pending`.
  await mockExpressionUpdate(page, 'five', {
    type: [],
    payload: { type: 'Pending' },
  })
  await expect(five).toHaveClass(/pending/)
  await expect.poll(() => nodeColor(five)).toBe(computedColor)
})
