import { Ast } from '@/util/ast'
import { expect, test } from 'vitest'
import {
  BUILTIN_REFUSED_ERROR,
  EVAL_IDENTIFIERS,
  EVAL_REFUSED_ERROR,
  NAME_LOOKUP_IDENTIFIERS,
  NAME_LOOKUP_REFUSED_ERROR,
  OUTPUT_ENABLING_IDENTIFIERS,
  REFLECTION_IDENTIFIERS,
  REFLECTION_REFUSED_ERROR,
  WRITE_REFUSED_ERROR,
  writeRefusal,
} from '../writeGuard'
import {
  BUILTIN_FUNCTION,
  BUILTIN_STATEMENTS,
  ENABLING_EXPRESSIONS,
  ENABLING_FUNCTION,
  ENABLING_IMPORTS,
  EVAL_EXPRESSIONS,
  EVAL_IMPORT,
  EVAL_TWO_STATEMENTS,
  HARMLESS_EXPRESSIONS,
  NAME_LOOKUP_EXPRESSIONS,
  REFLECTION_EXPRESSIONS,
  REFLECTION_IMPORT,
  REFLECTION_TWO_STATEMENTS,
} from './outputEnablingCode'

test('The refused identifiers and the answers', () => {
  expect([...OUTPUT_ENABLING_IDENTIFIERS].sort()).toEqual(['with_enabled', 'with_enabled_context'])
  expect([...REFLECTION_IDENTIFIERS]).toEqual(['meta'])
  expect([...EVAL_IDENTIFIERS]).toEqual(['eval'])
  expect([...NAME_LOOKUP_IDENTIFIERS].sort()).toEqual(['get_member', 'invoke'])
  expect(EVAL_REFUSED_ERROR).toBe(
    'Code that evaluates text as code (Debug.eval) is refused. Only the user can turn Write on, by clicking it on a node.',
  )
  expect(NAME_LOOKUP_REFUSED_ERROR).toBe(
    'Code that looks a method up by a name in text (Polyglot.get_member, Polyglot.invoke) is refused. Only the user can turn Write on, by clicking it on a node.',
  )
  expect(WRITE_REFUSED_ERROR).toBe(
    'Only the user can turn Write on. Remove with_enabled_context / with_enabled from the code; the user clicks Write on the node if they want it to run with output.',
  )
  expect(BUILTIN_REFUSED_ERROR).toBe(
    'Code that binds a runtime builtin (@Builtin_Method) is refused.',
  )
  expect(REFLECTION_REFUSED_ERROR).toBe(
    'Code that looks a method up by reflection (Meta.meta) is refused. Only the user can turn Write on, by clicking it on a node.',
  )
})

test.each(ENABLING_EXPRESSIONS)('enables output: %s', (code) => {
  expect(writeRefusal(Ast.parseBlock(code))).toBe(WRITE_REFUSED_ERROR)
})

test('A function body that enables output is found', () => {
  const definition = Ast.parseModuleStatement(ENABLING_FUNCTION)
  expect(definition).toBeInstanceOf(Ast.FunctionDef)
  expect(writeRefusal(definition!)).toBe(WRITE_REFUSED_ERROR)
})

test.each(ENABLING_IMPORTS)('an import of the enabling function is found: %s', (line) => {
  const statement = Ast.parseModuleStatement(line)
  expect(statement).toBeInstanceOf(Ast.Import)
  expect(writeRefusal(statement!)).toBe(WRITE_REFUSED_ERROR)
})

test.each(REFLECTION_EXPRESSIONS)('a method name built by reflection is refused: %s', (code) => {
  expect(writeRefusal(Ast.parseBlock(code))).toBe(REFLECTION_REFUSED_ERROR)
})

test('a renamed symbol bound in one statement and applied in the next is refused', () => {
  expect(writeRefusal(Ast.parseBlock(REFLECTION_TWO_STATEMENTS.join('\n')))).toBe(
    REFLECTION_REFUSED_ERROR,
  )
  expect(writeRefusal(Ast.parseBlockStatement(REFLECTION_TWO_STATEMENTS[0])!)).toBe(
    REFLECTION_REFUSED_ERROR,
  )
})

test('an import of Meta.meta under a plain name is refused', () => {
  const statement = Ast.parseModuleStatement(REFLECTION_IMPORT)
  expect(statement).toBeInstanceOf(Ast.Import)
  expect(writeRefusal(statement!)).toBe(REFLECTION_REFUSED_ERROR)
})

test('A function bound to a runtime builtin is refused', () => {
  const definition = Ast.parseModuleStatement(BUILTIN_FUNCTION)
  expect(definition).toBeInstanceOf(Ast.FunctionDef)
  expect(writeRefusal(definition!)).toBe(BUILTIN_REFUSED_ERROR)
})

test.each(BUILTIN_STATEMENTS)('a @Builtin_Method annotation is refused: %s', (code) => {
  expect(writeRefusal(Ast.parseBlock(code))).toBe(BUILTIN_REFUSED_ERROR)
})

test.each(EVAL_EXPRESSIONS)('code that evaluates text as code is refused: %s', (code) => {
  expect(writeRefusal(Ast.parseBlock(code))).toBe(EVAL_REFUSED_ERROR)
})

test('Debug.eval bound in one statement and applied in the next is refused', () => {
  expect(writeRefusal(Ast.parseBlock(EVAL_TWO_STATEMENTS.join('\n')))).toBe(EVAL_REFUSED_ERROR)
  expect(writeRefusal(Ast.parseBlockStatement(EVAL_TWO_STATEMENTS[0])!)).toBe(EVAL_REFUSED_ERROR)
})

test('an import of Debug.eval under a plain name is refused', () => {
  const statement = Ast.parseModuleStatement(EVAL_IMPORT)
  expect(statement).toBeInstanceOf(Ast.Import)
  expect(writeRefusal(statement!)).toBe(EVAL_REFUSED_ERROR)
})

test('A function whose body evaluates text as code is refused', () => {
  const definition = Ast.parseModuleStatement(`f x = ${EVAL_EXPRESSIONS[0]}`)
  expect(definition).toBeInstanceOf(Ast.FunctionDef)
  expect(writeRefusal(definition!)).toBe(EVAL_REFUSED_ERROR)
})

test.each(NAME_LOOKUP_EXPRESSIONS)(
  'a method looked up by a name in text is refused: %s',
  (code) => {
    expect(writeRefusal(Ast.parseBlock(code))).toBe(NAME_LOOKUP_REFUSED_ERROR)
  },
)

test.each([...HARMLESS_EXPRESSIONS, '## with_enabled\n1', '@Tail_Call foo 1', 'Builtin_Method'])(
  'is not refused: %s',
  (code) => {
    expect(writeRefusal(Ast.parseBlock(code))).toBeUndefined()
  },
)
