import { Ast } from '@/util/ast'
import type { Result } from 'enso-common/src/utilities/data/result'
import { expect, test } from 'vitest'
import { addImportLines, parseImportLines } from '../importLines'
import { EVAL_REFUSED_ERROR } from '../writeGuard'
import { EVAL_IMPORT } from './outputEnablingCode'

function errorOf(result: Result<unknown>): string {
  if (result.ok) throw new Error('expected Err')
  return result.error.message('')
}

function buildModule(code: string) {
  const edit = Ast.MutableModule.Transient()
  const topLevel = Ast.parseModule(code, edit)
  edit.setRoot(topLevel)
  return { edit, topLevel }
}

test('Both forms of import line parse', () => {
  const result = parseImportLines([
    'from Standard.Excel import all',
    'import Standard.Base.Data.Text',
  ])
  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.value.map((s) => s.code())).toEqual([
    'from Standard.Excel import all',
    'import Standard.Base.Data.Text',
  ])
  expect(result.value.every((s) => s instanceof Ast.Import)).toBe(true)
})

test('A line that is not an import is refused, naming it', () => {
  const result = parseImportLines(['import Standard.Base', 'x = 1'])
  expect(errorOf(result)).toBe(
    'Not an import line: `x = 1`. Pass whole import lines, such as `from Standard.Table import all`.',
  )
})

test('An import of Debug.eval is refused', () => {
  expect(errorOf(parseImportLines(['from Standard.Table import all', EVAL_IMPORT]))).toBe(
    EVAL_REFUSED_ERROR,
  )
})

test('An empty line or two imports on one line are refused', () => {
  expect(errorOf(parseImportLines(['']))).toContain('Not an import line: ``')
  expect(errorOf(parseImportLines(['import A\nimport B']))).toContain('Not an import line')
})

test('An import with a syntax error is refused', () => {
  expect(errorOf(parseImportLines(['from Standard.Table import (']))).toContain(
    'Not an import line',
  )
})

test('addImportLines adds a missing line after the existing imports and skips one present', () => {
  const { edit, topLevel } = buildModule(
    [
      'import Standard.Base.Data.Numbers',
      'from Standard.Table import all',
      '',
      'main =',
      '    x = 1',
      '',
    ].join('\n'),
  )
  const added = addImportLines(edit, [
    'from  Standard.Table   import all',
    'from Standard.Excel import all',
    'from Standard.Excel import all',
  ])
  expect(added).toEqual({ ok: true, value: 1 })
  expect(edit.getVersion(topLevel).code()).toBe(
    [
      'import Standard.Base.Data.Numbers',
      'from Standard.Table import all',
      'from Standard.Excel import all',
      '',
      'main =',
      '    x = 1',
      '',
    ].join('\n'),
  )
})

test('addImportLines puts the first import at the top of a module without any', () => {
  const { edit, topLevel } = buildModule(['main =', '    x = 1', ''].join('\n'))
  expect(addImportLines(edit, ['import Standard.Base'])).toEqual({ ok: true, value: 1 })
  expect(edit.getVersion(topLevel).code()).toBe(
    ['import Standard.Base', 'main =', '    x = 1', ''].join('\n'),
  )
})

test('addImportLines changes nothing when a line does not parse', () => {
  const code = ['import Standard.Base', '', 'main =', '    x = 1', ''].join('\n')
  const { edit, topLevel } = buildModule(code)
  const result = addImportLines(edit, ['from Standard.Excel import all', 'oops'])
  expect(errorOf(result)).toContain('Not an import line: `oops`')
  expect(edit.getVersion(topLevel).code()).toBe(code)
})
