import { Ast } from '@/util/ast'
import { expect, test } from 'vitest'
import { enablesOutput, OUTPUT_ENABLING_IDENTIFIERS, WRITE_REFUSED_ERROR } from '../writeGuard'
import {
  ENABLING_EXPRESSIONS,
  ENABLING_FUNCTION,
  ENABLING_IMPORTS,
  HARMLESS_EXPRESSIONS,
} from './outputEnablingCode'

test('The refused identifiers are the two public ways of enabling a context', () => {
  expect([...OUTPUT_ENABLING_IDENTIFIERS].sort()).toEqual(['with_enabled', 'with_enabled_context'])
  expect(WRITE_REFUSED_ERROR).toBe(
    'Only the user can turn Write on. Remove with_enabled_context / with_enabled from the code; the user clicks Write on the node if they want it to run with output.',
  )
})

test.each(ENABLING_EXPRESSIONS)('enables output: %s', (code) => {
  expect(enablesOutput(Ast.parseBlock(code))).toBe(true)
})

test('A function body that enables output is found', () => {
  const definition = Ast.parseModuleStatement(ENABLING_FUNCTION)
  expect(definition).toBeInstanceOf(Ast.FunctionDef)
  expect(enablesOutput(definition!)).toBe(true)
})

test.each(ENABLING_IMPORTS)('an import of the enabling function is found: %s', (line) => {
  const statement = Ast.parseModuleStatement(line)
  expect(statement).toBeInstanceOf(Ast.Import)
  expect(enablesOutput(statement!)).toBe(true)
})

test.each([...HARMLESS_EXPRESSIONS, '## with_enabled\n1'])('does not enable output: %s', (code) => {
  expect(enablesOutput(Ast.parseBlock(code))).toBe(false)
})
