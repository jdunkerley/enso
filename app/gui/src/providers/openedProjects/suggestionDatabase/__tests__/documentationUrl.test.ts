import {
  documentationBase,
  suggestionDocumentationUrl,
} from '$/providers/openedProjects/suggestionDatabase/entry'
import {
  makeArgument,
  makeConstructor,
  makeFunction,
  makeMethod,
  makeModule,
  makeModuleMethod,
  makeStaticMethod,
  makeType,
} from '$/providers/openedProjects/suggestionDatabase/mockSuggestion'
import { ProjectPath } from '@/util/projectPath'
import type { QualifiedName } from '@/util/qualifiedName'
import { expect, test } from 'vitest'

const BASE = 'https://jdunkerley.github.io/enso/docs/'

test.each([
  // A method of a type.
  [
    makeMethod('Standard.Table.Table.Table.filter'),
    `${BASE}api/Standard.Table/Table/Table.filter/`,
  ],
  // A module function.
  [makeModuleMethod('Standard.Base.Data.read'), `${BASE}api/Standard.Base/Data/read/`],
  // An extension method: the page is in the module that defines it, named for its self type.
  [
    makeMethod('Standard.Base.Data.Vector.Vector.to_table', {
      module: 'Standard.Table.Extensions',
    }),
    `${BASE}api/Standard.Table/Extensions/Vector.to_table/`,
  ],
  // A member of a `Main` module.
  [
    makeModuleMethod('Standard.Base.Main.some_function'),
    `${BASE}api/Standard.Base/Main/some_function/`,
  ],
  // An operator.
  [
    makeMethod('Standard.Base.Data.Numbers.Integer.+'),
    `${BASE}api/Standard.Base/Data/Numbers/Integer.op-2b/`,
  ],
  [
    makeConstructor('Standard.Base.Data.Filter_Condition.Filter_Condition.Equal'),
    `${BASE}api/Standard.Base/Data/Filter_Condition/Filter_Condition.Equal/`,
  ],
  [makeType('Standard.Table.Table.Table'), `${BASE}api/Standard.Table/Table/Table/`],
  [makeModule('Standard.Table.Table'), `${BASE}api/Standard.Table/Table/`],
  // The user's own code, and what is not a library entity, have no page.
  [makeMethod('local.Project.Main.Foo.bar'), undefined],
  [makeFunction('Standard.Base.Main', 'local_function'), undefined],
])('%#', (entry, url) => {
  expect(suggestionDocumentationUrl(entry, BASE)).toBe(url)
})

test('a conversion has no page: the site lists it on the target type', () => {
  const conversion = makeMethod('Standard.Base.Data.Hashset.Hashset.from', {
    args: [makeArgument('that')],
  })
  expect(suggestionDocumentationUrl(conversion, BASE)).toBeUndefined()
  // A static `from` (a plain constructor-like method) does have a page.
  const staticFrom = makeStaticMethod('Standard.Base.Data.Hashset.Hashset.from', {
    args: [makeArgument('that')],
  })
  expect(suggestionDocumentationUrl(staticFrom, BASE)).toBe(
    `${BASE}api/Standard.Base/Data/Hashset/Hashset.from/`,
  )
})

test('a base without its trailing slash still gives the page', () => {
  const entry = makeModuleMethod('Standard.Base.Data.read')
  expect(suggestionDocumentationUrl(entry, BASE.slice(0, -1))).toBe(
    `${BASE}api/Standard.Base/Data/read/`,
  )
  expect(suggestionDocumentationUrl(entry, `${BASE}//`)).toBe(`${BASE}api/Standard.Base/Data/read/`)
})

test('an empty base switches the links off', () => {
  expect(documentationBase(undefined)).toBeUndefined()
  expect(documentationBase('')).toBeUndefined()
  expect(documentationBase('  ')).toBeUndefined()
  expect(
    suggestionDocumentationUrl(makeModuleMethod('Standard.Base.Data.read'), ''),
  ).toBeUndefined()
})

test('an entry apiPath cannot place has no page, and does not throw', () => {
  // A module with too few segments: `apiPath` refuses it.
  const odd = {
    ...makeModule('Standard.Table.Table'),
    definedIn: ProjectPath.create('Standard' as QualifiedName, undefined),
  }
  expect(() => suggestionDocumentationUrl(odd, BASE)).not.toThrow()
  expect(suggestionDocumentationUrl(odd, BASE)).toBeUndefined()
})
