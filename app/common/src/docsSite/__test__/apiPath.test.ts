import { describe, expect, test } from 'vitest'
import { apiPath, memberSegment, type ApiPathEntry } from '../apiPath'

const table = 'Standard.Table.Table.Table'

describe('apiPath', () => {
  // The cases `suggestionDocumentationUrl` (entry.ts, removed by #566) handled: the library, the
  // module path one segment per name, then the definition path with the module path removed.
  test.each<[string, ApiPathEntry, string]>([
    [
      'instance method',
      { kind: 'method', module: 'Standard.Table.Table', name: 'filter', owner: table },
      'Standard.Table/Table/Table.filter',
    ],
    [
      'static method',
      { kind: 'method', module: 'Standard.Table.Table', name: 'new', owner: table },
      'Standard.Table/Table/Table.new',
    ],
    [
      'module function',
      { kind: 'method', module: 'Standard.Base.Data', name: 'read', owner: 'Standard.Base.Data' },
      'Standard.Base/Data/read',
    ],
    [
      'extension method',
      {
        kind: 'method',
        module: 'Standard.Table.Extensions.Table_Conversions',
        name: 'parse_to_table',
        owner: 'Standard.Base.Data.Text.Text',
      },
      'Standard.Table/Extensions/Table_Conversions/Text.parse_to_table',
    ],
  ])('matches the old IDE link: %s', (_, entry, expected) => {
    expect(apiPath(entry)).toBe(expected)
  })

  test.each<[string, ApiPathEntry, string]>([
    [
      'constructor',
      {
        kind: 'constructor',
        module: 'Standard.Base.Data.Filter_Condition',
        name: 'Equal',
        owner: 'Standard.Base.Data.Filter_Condition.Filter_Condition',
      },
      'Standard.Base/Data/Filter_Condition/Filter_Condition.Equal',
    ],
    [
      'type',
      { kind: 'type', module: 'Standard.Table.Table', name: 'Table' },
      'Standard.Table/Table/Table',
    ],
    ['module', { kind: 'module', module: 'Standard.Table.Table' }, 'Standard.Table/Table'],
    [
      'Main module is the library page',
      { kind: 'module', module: 'Standard.Table.Main' },
      'Standard.Table',
    ],
    [
      'a member of Main keeps the Main segment',
      { kind: 'method', module: 'Standard.Table.Main', name: 'f', owner: 'Standard.Table.Main' },
      'Standard.Table/Main/f',
    ],
    [
      'operator',
      {
        kind: 'method',
        module: 'Standard.Base.Data.Numbers',
        name: '+',
        owner: 'Standard.Base.Data.Numbers.Integer',
      },
      'Standard.Base/Data/Numbers/Integer.op-2b',
    ],
  ])('%s', (_, entry, expected) => {
    expect(apiPath(entry)).toBe(expected)
  })

  test('a member without a name is an error', () => {
    expect(() =>
      apiPath({ kind: 'method', module: 'Standard.Base.Data', owner: 'Standard.Base.Data' }),
    ).toThrow()
  })
  test('a module that is not fully qualified is an error', () => {
    expect(() => apiPath({ kind: 'module', module: 'Main' })).toThrow()
  })
})

describe('memberSegment', () => {
  test.each([
    ['filter', 'filter'],
    ['Value', 'Value'],
    ['+', 'op-2b'],
    ['<=', 'op-3c3d'],
    ['==', 'op-3d3d'],
    ['||', 'op-7c7c'],
    ['→', 'op-e28692'],
  ])('%s → %s', (name, segment) => {
    expect(memberSegment(name)).toBe(segment)
  })
})
