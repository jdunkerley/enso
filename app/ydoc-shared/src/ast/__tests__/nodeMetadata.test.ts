import { expect, test } from 'vitest'
import { isLocalUserActionOrigin, tryAsOrigin } from '../../yjsModel'
import { MutableModule } from '../mutableModule'
import { parseExpression } from '../parse'

function expression() {
  return parseExpression('a + 1', MutableModule.Transient())!
}

test('setNodeMetadata stores and serializes cachedAppearance', () => {
  const expr = expression()
  expr.setNodeMetadata({
    cachedAppearance: { color: '#4a7fb0', icon: 'table' },
  })
  expect(expr.nodeMetadata.get('cachedAppearance')).toEqual({
    color: '#4a7fb0',
    icon: 'table',
  })
  expect(expr.serializeMetadata().cachedAppearance).toEqual({
    color: '#4a7fb0',
    icon: 'table',
  })
})

test('setNodeMetadata with an undefined cachedAppearance removes it', () => {
  const expr = expression()
  expr.setNodeMetadata({ cachedAppearance: { color: '#4a7fb0' } })
  expr.setNodeMetadata({ cachedAppearance: undefined })
  expect(expr.nodeMetadata.get('cachedAppearance')).toBeUndefined()
})

test('derived metadata origin is known but is not a user action', () => {
  expect(tryAsOrigin('local:derivedMetadata')).toBe('local:derivedMetadata')
  expect(isLocalUserActionOrigin('local:derivedMetadata')).toBe(false)
})
