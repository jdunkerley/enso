import { suggestionDocumentationUrl } from '$/providers/openedProjects/suggestionDatabase/entry'
import {
  makeConstructor,
  makeFunction,
  makeMethod,
  makeModule,
  makeModuleMethod,
  makeType,
} from '$/providers/openedProjects/suggestionDatabase/mockSuggestion'
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
