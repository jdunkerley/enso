/** @file Which format library a path needs, for `Data.read` with format on `Auto_Detect` (#489). */
import {
  makeArgument,
  makeMethod,
} from '$/providers/openedProjects/suggestionDatabase/mockSuggestion'
import {
  DisplayMode,
  type WidgetConfiguration,
  type WithDisplay,
} from '$/providers/openedProjects/widgetRegistry/configuration'
import { Ast } from '@/util/ast'
import { ArgumentApplication, ArgumentAst, interpretCall } from '@/util/callTree'
import { assert, describe, expect, test } from 'vitest'
import { assertDefined } from 'ydoc-shared/util/assert'
import {
  fileNameOf,
  formatTypeForPath,
  formatTypeForPathUpdate,
  isAutoDetect,
  matchesNamePattern,
  pathTextOf,
} from '../formatForPath'

const SQLITE = 'Standard.SQLite.SQLite_Format.SQLite_Format'
const TABLE_EXCEL = 'Standard.Table.Excel.Excel_Format.Excel_Format'
const TABLE_DELIMITED = 'Standard.Table.Delimited.Delimited_Format.Delimited_Format'

const option = (label: string, value: string, requires?: string, patterns?: string[]) => ({
  label,
  value,
  parameters: [],
  ...(requires ? { requires } : {}),
  ...(patterns ? { patterns } : {}),
})

const FORMAT_CONFIG: WidgetConfiguration & WithDisplay = {
  kind: 'Single_Choice',
  label: null,
  display: DisplayMode.WhenModified,
  values: [
    option('Auto Detect', 'Standard.Base.System.File_Format.Auto_Detect'),
    option('SQLite', '..SQLite', SQLITE, ['*.sqlite', '*.db']),
    option('Delimited', '..Delimited', TABLE_DELIMITED, ['*.csv', '*.tsv', '*.tab']),
    option('Excel Workbook', '..Workbook', TABLE_EXCEL, ['*.xls', '*.xlsx']),
    option('Excel Sheet', '..Sheet', TABLE_EXCEL, ['*.xls', '*.xlsx']),
  ],
}

describe('matchesNamePattern', () => {
  // Every pattern a shipped format's `get_name_patterns` gives, with a file it must read.
  test.each([
    ['*.txt', 'a.txt'],
    ['*.log', 'a.log'],
    ['*.dat', 'a.dat'],
    ['*.json', 'a.json'],
    ['*.geojson', 'a.geojson'],
    ['*.jsonl', 'a.jsonl'],
    ['*.xml', 'a.xml'],
    ['*.parquet', 'a.parquet'],
    ['*.png', 'a.png'],
    ['*.tiff', 'a.tiff'],
    ['*.sqlite', 'a.sqlite'],
    ['*.db', 'a.db'],
    ['*.csv', 'a.csv'],
    ['*.tsv', 'a.tsv'],
    ['*.tab', 'a.tab'],
    ['*.xls', 'a.xls'],
    ['*.xlsx', 'a.xlsx'],
    ['*.xlsm', 'a.xlsm'],
    ['*.xlt', 'a.xlt'],
    ['*.xlsb', 'a.xlsb'],
    ['*.edi', 'a.edi'],
    ['*.822', 'a.822'],
    ['*.yxdb', 'a.yxdb'],
    ['*.hyper', 'a.hyper'],
  ])('%s matches %s', (pattern, fileName) => {
    expect(matchesNamePattern(pattern, fileName)).toBe(true)
  })
  test('case is ignored, as Auto_Detect ignores it', () => {
    expect(matchesNamePattern('*.db', 'Sales.DB')).toBe(true)
  })
  test('the whole name must match', () => {
    expect(matchesNamePattern('*.json', 'a.jsonl')).toBe(false)
    expect(matchesNamePattern('*.xls', 'a.xlsx')).toBe(false)
    expect(matchesNamePattern('*.db', 'db')).toBe(false)
  })
  test('? is one character and everything else is literal', () => {
    expect(matchesNamePattern('data?.csv', 'data1.csv')).toBe(true)
    expect(matchesNamePattern('data?.csv', 'data12.csv')).toBe(false)
    expect(matchesNamePattern('*.c+v', 'a.ccv')).toBe(false)
  })
})

describe('fileNameOf', () => {
  test.each([
    ['/home/user/Sales.db', 'Sales.db'],
    ['C:\\Users\\me\\Sales.db', 'Sales.db'],
    ['Sales.db', 'Sales.db'],
    ['https://example.com/files/sales.csv?raw=1#top', 'sales.csv'],
    ['/home/user/', ''],
    ['/d/report#1.db', 'report#1.db'],
    ['C:\\d\\what?.db', 'what?.db'],
  ])('%s is %s', (path, name) => expect(fileNameOf(path)).toBe(name))
})

describe('formatTypeForPath', () => {
  test('a .db file needs SQLite', () => {
    expect(formatTypeForPath('/data/Sales.db', FORMAT_CONFIG)).toBe(SQLITE)
  })
  test('an extension no format claims needs nothing', () => {
    expect(formatTypeForPath('/data/notes.xyz', FORMAT_CONFIG)).toBeUndefined()
  })
  test('several options of one format type count once', () => {
    expect(formatTypeForPath('/data/Sales.xlsx', FORMAT_CONFIG)).toBe(TABLE_EXCEL)
  })
  test('options of two format types matching is ambiguous, so nothing', () => {
    const ambiguous: WidgetConfiguration = {
      ...FORMAT_CONFIG,
      kind: 'Single_Choice',
      values: [
        option('SQLite', '..SQLite', SQLITE, ['*.db']),
        option('Other', '..Other', 'Standard.Other.Other_Format.Other_Format', ['*.db']),
      ],
    }
    expect(formatTypeForPath('/data/Sales.db', ambiguous)).toBeUndefined()
  })
  test('without a choice configuration, nothing', () => {
    expect(formatTypeForPath('/data/Sales.db', undefined)).toBeUndefined()
    expect(
      formatTypeForPath('/data/Sales.db', {
        kind: 'Text_Input',
        display: DisplayMode.Always,
      }),
    ).toBeUndefined()
  })
})

describe('isAutoDetect', () => {
  test.each([
    ['Auto_Detect', true],
    ['..Auto_Detect', true],
    ['Standard.Base.System.File_Format.Auto_Detect', true],
    ['..SQLite', false],
    ['(Delimited_Format.Delimited ",")', false],
  ])('%s is %s', (code, expected) => expect(isAutoDetect(code)).toBe(expected))
})

describe('pathTextOf', () => {
  test('of a text literal, a string, or File.new', () => {
    expect(pathTextOf(Ast.TextLiteral.new('/a/b.db'))).toBe('/a/b.db')
    expect(pathTextOf("'/a/b.db'")).toBe('/a/b.db')
    expect(pathTextOf(Ast.parseExpression("(File.new '/a/b.db')"))).toBe('/a/b.db')
  })
  test('of something without text, undefined', () => {
    expect(pathTextOf(Ast.parseExpression('x'))).toBeUndefined()
    expect(pathTextOf(undefined)).toBeUndefined()
  })
})

const DATA_READ = makeMethod('Standard.Base.Data.read', {
  module: 'Standard.Base.Data',
  isStatic: true,
  args: [makeArgument('path'), makeArgument('format'), makeArgument('on_problems')],
})

function dataRead(code: string): ArgumentApplication {
  const ast = Ast.parseExpression(code)
  assertDefined(ast)
  const app = ArgumentApplication.FromInterpretedWithInfo(interpretCall(ast), {
    suggestion: DATA_READ,
    widgetCfg: {
      kind: 'FunctionCall',
      parameters: new Map([['format', FORMAT_CONFIG]]),
    },
  })
  assert(app instanceof ArgumentApplication)
  return app
}

function argument(app: ArgumentApplication, name: string) {
  const arg = [...app.iterApplications()]
    .map((a) => a.argument)
    .find((a) => a.argInfo?.name === name)
  assertDefined(arg)
  return arg
}

describe('formatTypeForPathUpdate', () => {
  test('a path set on the placeholder (the file browser, or typing)', () => {
    const app = dataRead('Data.read')
    const update = {
      portUpdate: {
        origin: argument(app, 'path').portId,
        value: Ast.TextLiteral.new('/d/S.db'),
      },
    }
    expect(formatTypeForPathUpdate(app, update)).toBe(SQLITE)
  })
  test('a path literal replaced', () => {
    const app = dataRead("Data.read '/d/notes.txt'")
    const update = {
      portUpdate: {
        origin: argument(app, 'path').portId,
        value: Ast.TextLiteral.new('/d/S.db'),
      },
    }
    expect(formatTypeForPathUpdate(app, update)).toBe(SQLITE)
  })
  test('the literal inside File.new replaced', () => {
    const app = dataRead("Data.read (File.new '/d/notes.txt')")
    const path = argument(app, 'path')
    assert(path instanceof ArgumentAst)
    let literal: Ast.Ast | undefined
    Ast.visitRecursive(path.ast, (node) => {
      if (node instanceof Ast.TextLiteral) literal = node
      return literal == null
    })
    assertDefined(literal)
    const update = {
      portUpdate: { origin: literal.id, value: Ast.TextLiteral.new('/d/S.db') },
    }
    expect(formatTypeForPathUpdate(app, update)).toBe(SQLITE)
  })
  test('a path literal edited in place (typing into it)', () => {
    const app = dataRead("Data.read '/d/notes.txt'")
    const path = argument(app, 'path')
    assert(path instanceof ArgumentAst && path.ast instanceof Ast.TextLiteral)
    const edit = path.ast.module.edit()
    edit.getVersion(path.ast).setRawTextContent('/d/S.db')
    expect(formatTypeForPathUpdate(app, { edit })).toBe(SQLITE)
  })
  test('an edit that leaves the path as it was adds nothing', () => {
    const app = dataRead("Data.read '/d/S.db'")
    const path = argument(app, 'path')
    assert(path instanceof ArgumentAst)
    expect(formatTypeForPathUpdate(app, { edit: path.ast.module.edit() })).toBeUndefined()
  })
  test('an explicit format other than Auto_Detect adds nothing from the path', () => {
    const app = dataRead("Data.read '/d/notes.txt' ..Delimited")
    const update = {
      portUpdate: {
        origin: argument(app, 'path').portId,
        value: Ast.TextLiteral.new('/d/S.db'),
      },
    }
    expect(formatTypeForPathUpdate(app, update)).toBeUndefined()
  })
  test('an explicit Auto_Detect still counts', () => {
    const app = dataRead("Data.read '/d/notes.txt' ..Auto_Detect")
    const update = {
      portUpdate: {
        origin: argument(app, 'path').portId,
        value: Ast.TextLiteral.new('/d/S.db'),
      },
    }
    expect(formatTypeForPathUpdate(app, update)).toBe(SQLITE)
  })
  test('an update of another argument adds nothing', () => {
    const app = dataRead("Data.read '/d/S.db'")
    const update = {
      portUpdate: {
        origin: argument(app, 'on_problems').portId,
        value: '..Report_Error',
      },
    }
    expect(formatTypeForPathUpdate(app, update)).toBeUndefined()
  })
})
