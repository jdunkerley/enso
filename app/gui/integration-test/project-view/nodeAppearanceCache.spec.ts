import { expect, test } from 'integration-test/base'
import { mockExpressionUpdate, mockMethodCallInfo } from './expressionUpdates'
import * as locate from './locate'

async function nodeColor(node: ReturnType<typeof locate.graphNodeByBinding>) {
  const style = (await node.getAttribute('style')) ?? ''
  return /--node-group-color:\s*([^;]+)/.exec(style)?.[1]?.trim()
}

/**
 * The node's displayed colour, resolved to a concrete CSS colour even when
 * {@link nodeColor} returns a `var(--…)` reference (e.g. a library group's colour) - so it can be
 * compared directly with the resolved colour the cache stores (see `global-constraints.md`: only
 * a resolved colour is ever cached, never a `var(--…)` reference).
 */
async function resolvedNodeColor(node: ReturnType<typeof locate.graphNodeByBinding>) {
  const raw = await nodeColor(node)
  const varMatch = raw && /^var\((--[\w-]+)\)$/.exec(raw)
  if (!varMatch) return raw
  return await node.evaluate(
    (el, varName) => getComputedStyle(el).getPropertyValue(varName).trim(),
    varMatch[1],
  )
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

  // Computed with a known method call, so it gets a library group's colour, which is then
  // cached. (A type update is not used here: `ComputedValueRegistry` never clears a node's
  // `typeInfo` once set - see `updateInfo` in `computedValueRegistry.ts` - so a node whose colour
  // comes from its *type* can never be driven back to "unknown" within one session. A
  // `methodCall`, and therefore a *group* colour, does not have that restriction: it is cleared by
  // any non-pending update that omits it.)
  await mockMethodCallInfo(page, 'five', {
    methodPointer: {
      module: 'Standard.Base.Data',
      definedOnType: 'Standard.Base.Data',
      name: 'read',
    },
    notAppliedArguments: [],
  })
  await expect(five).not.toHaveClass(/pending/)
  const computedColor = await resolvedNodeColor(five)
  expect(computedColor).toBeDefined()
  expect(computedColor).not.toBe('var(--node-color-no-type)')

  // The method call is no longer reported (e.g. the node is about to be re-evaluated): with no
  // group or type known, the cached colour is already shown here, before the node is even
  // pending.
  await mockExpressionUpdate(page, 'five', { type: [], payload: { type: 'Value' } })
  await expect.poll(() => resolvedNodeColor(five)).toBe(computedColor)

  // Pending again with no group or type info: the cached colour is shown, faded by `.pending`.
  await mockExpressionUpdate(page, 'five', { type: [], payload: { type: 'Pending' } })
  await expect(five).toHaveClass(/pending/)
  await expect.poll(() => resolvedNodeColor(five)).toBe(computedColor)
})
