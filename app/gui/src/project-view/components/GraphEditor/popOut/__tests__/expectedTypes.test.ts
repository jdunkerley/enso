import type { MethodCallInfo } from '$/providers/openedProjects/graph/graphDatabase'
import {
  makeArgument,
  makeMethod,
} from '$/providers/openedProjects/suggestionDatabase/mockSuggestion'
import { Ast } from '@/util/ast'
import { interpretCall } from '@/util/callTree'
import { parseAbsoluteProjectPath } from '@/util/projectPath'
import { tryQualifiedName, type Identifier } from '@/util/qualifiedName'
import { unwrap } from 'enso-common/src/utilities/data/result'
import { assert, expect, test } from 'vitest'
import { assertDefined } from 'ydoc-shared/util/assert'
import { expectedTypesIn } from '../expectedTypes'

const DATE_PERIOD = 'Standard.Base.Data.Time.Date_Period.Date_Period'

function stdPath(path: string) {
  return unwrap(parseAbsoluteProjectPath(unwrap(tryQualifiedName(path))))
}

const DATE = 'Standard.Base.Data.Time.Date.Date'
const upToEntry = makeMethod('Standard.Base.Data.Time.Date.Date.up_to', {
  args: [
    makeArgument('self', DATE),
    makeArgument('end', DATE),
    { ...makeArgument('include_end', 'Standard.Base.Data.Boolean.Boolean'), hasDefault: true },
    makeArgument('step', DATE_PERIOD),
  ],
})

function infoFor(id: Ast.AstId, notAppliedArguments: number[]): MethodCallInfo {
  return {
    methodCall: {
      methodPointer: {
        module: stdPath('Standard.Base.Data.Time.Date'),
        definedOnType: stdPath(DATE),
        name: 'up_to' as Identifier,
      },
      notAppliedArguments,
    },
    methodCallSource: id,
    suggestion: upToEntry,
  }
}

/** A database that knows the call (nothing applied beyond `applied`) and the bare function. */
function fakeDb(call: Ast.Expression, bareNotApplied: number[], callNotApplied: number[] = []) {
  const func = interpretCall(call).func
  const infos = new Map([
    [call.id, infoFor(call.id, callNotApplied)],
    [func.id, infoFor(func.id, bareNotApplied)],
  ])
  return { getMethodCallInfo: (id: Ast.AstId) => infos.get(id) }
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
  const types = expectedTypesIn(e, 'Root_Type', fakeDb(e, [1, 2, 3]))
  expect(types.get(e.id)).toBe('Root_Type')
  const stepValue = findAutoscoped(e)
  expect(types.get(stepValue.id)).toBe(DATE_PERIOD)
  // The named argument's App node (here the root) keeps the root type, not the argument's.
  expect(types.get(e.id)).not.toBe(DATE_PERIOD)
  const noRoot = expectedTypesIn(e, undefined, fakeDb(e, [1, 2, 3]))
  expect(noRoot.has(e.id)).toBe(false)
  expect(noRoot.get(stepValue.id)).toBe(DATE_PERIOD)
})

test('a positional autoscoped argument takes the type of its position (include_end)', () => {
  const e = Ast.parseExpression('d.up_to e ..Month')!
  const types = expectedTypesIn(e, undefined, fakeDb(e, [1, 2, 3]))
  expect(types.get(findAutoscoped(e).id)).toBe('Standard.Base.Data.Boolean.Boolean')
})

test('Type.method called with self as the first argument', () => {
  const e = Ast.parseExpression('Date.up_to d e step=..Month')!
  const types = expectedTypesIn(e, undefined, fakeDb(e, [0, 1, 2, 3]))
  const args = interpretCall(e)
  assert(args.kind === 'prefix')
  const [d, end, step] = args.args.map((a) => a.argument.id)
  expect(types.get(d!)).toBe(DATE)
  expect(types.get(end!)).toBe(DATE)
  expect(types.get(step!)).toBe(DATE_PERIOD)
})

test('an argument of type Any is left unknown', () => {
  const e = Ast.parseExpression('foo ..Month')!
  const anyEntry = makeMethod('Standard.Base.Data.Foo.foo', { args: [makeArgument('x')] })
  const db = {
    getMethodCallInfo: (id: Ast.AstId) =>
      id === e.id ? { ...infoFor(e.id, []), suggestion: anyEntry } : undefined,
  }
  expect(expectedTypesIn(e, undefined, db).size).toBe(0)
})

test('calls without info contribute nothing', () => {
  const e = Ast.parseExpression('foo ..Month')!
  const types = expectedTypesIn(e, undefined, { getMethodCallInfo: () => undefined })
  expect(types.size).toBe(0)
})
