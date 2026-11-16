import type { MethodCallInfo } from '$/providers/openedProjects/graph/graphDatabase'
import {
  makeArgument,
  makeMethod,
} from '$/providers/openedProjects/suggestionDatabase/mockSuggestion'
import { Ast } from '@/util/ast'
import { parseAbsoluteProjectPath } from '@/util/projectPath'
import { tryQualifiedName, type Identifier } from '@/util/qualifiedName'
import { unwrap } from 'enso-common/src/utilities/data/result'
import { expect, test } from 'vitest'
import { assertDefined } from 'ydoc-shared/util/assert'
import { expectedTypesIn } from '../expectedTypes'

const DATE_PERIOD = 'Standard.Base.Data.Time.Date_Period.Date_Period'

function stdPath(path: string) {
  return unwrap(parseAbsoluteProjectPath(unwrap(tryQualifiedName(path))))
}

const upToEntry = makeMethod('Standard.Base.Data.Time.Date.Date.up_to', {
  args: [
    makeArgument('self', 'Standard.Base.Data.Time.Date.Date'),
    makeArgument('end', 'Standard.Base.Data.Time.Date.Date'),
    makeArgument('step', DATE_PERIOD),
  ],
})

function fakeDb(callId: Ast.AstId) {
  const info: MethodCallInfo = {
    methodCall: {
      methodPointer: {
        module: stdPath('Standard.Base.Data.Time.Date'),
        definedOnType: stdPath('Standard.Base.Data.Time.Date.Date'),
        name: 'up_to' as Identifier,
      },
      notAppliedArguments: [],
    },
    methodCallSource: callId,
    suggestion: upToEntry,
  }
  return { getMethodCallInfo: (id: Ast.AstId) => (id === callId ? info : undefined) }
}

function findAutoscoped(e: Ast.Ast): Ast.AutoscopedIdentifier {
  let found: Ast.AutoscopedIdentifier | undefined
  Ast.visitRecursive(e, (ast) => {
    if (ast instanceof Ast.AutoscopedIdentifier) found = ast
    return true
  })
  assertDefined(found)
  return found
}

test('the root and each argument of a known call', () => {
  const e = Ast.parseExpression('d.up_to e step=..Month')!
  const types = expectedTypesIn(e, 'Root_Type', fakeDb(e.id))
  expect(types.get(e.id)).toBe('Root_Type')
  const stepValue = findAutoscoped(e)
  expect(types.get(stepValue.id)).toBe(DATE_PERIOD)
  // The named argument's App node (here the root) keeps the root type, not the argument's.
  expect(types.get(e.id)).not.toBe(DATE_PERIOD)
  const noRoot = expectedTypesIn(e, undefined, fakeDb(e.id))
  expect(noRoot.has(e.id)).toBe(false)
  expect(noRoot.get(stepValue.id)).toBe(DATE_PERIOD)
})

test('a positional autoscoped argument is keyed by its own id', () => {
  const e = Ast.parseExpression('d.up_to e ..Month')!
  const types = expectedTypesIn(e, undefined, fakeDb(e.id))
  expect(types.get(findAutoscoped(e).id)).toBe(DATE_PERIOD)
})

test('calls without info contribute nothing', () => {
  const e = Ast.parseExpression('foo ..Month')!
  const types = expectedTypesIn(e, undefined, { getMethodCallInfo: () => undefined })
  expect(types.size).toBe(0)
})
