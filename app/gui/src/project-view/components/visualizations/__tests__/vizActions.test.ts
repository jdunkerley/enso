/** @file Tests for the node action builder. */
import type { NodeCreationOptions } from '@/components/GraphEditor/nodeCreation'
import { Ast } from '@/util/ast'
import type { Pattern } from '@/util/ast/match'
import { describe, expect, test } from 'vitest'
import { isActionButton } from '../toolbar'
import {
  actionPattern,
  chainPattern,
  findAction,
  isPlainAction,
  parseVizActions,
  placeholderNames,
  plainActionToolbar,
  type VizAction,
} from '../vizActions'

function text(pattern: Pattern | undefined) {
  return pattern?.instantiateCopied([Ast.parseExpression('operator1')!]).code()
}

/** The contents of the text literals in the code `pattern` prints for the node `operator1`. */
function textLiterals(pattern: Pattern | undefined): string[] {
  const root = pattern?.instantiateCopied([Ast.parseExpression('operator1')!])
  const found: string[] = []
  if (root)
    Ast.visitRecursive(root, (ast) => {
      if (ast instanceof Ast.TextLiteral) found.push(ast.rawTextContent)
    })
  return found
}

const chain = (template: string): VizAction => ({
  id: 'x',
  label: 'X',
  icon: '',
  kind: 'chain',
  template,
})

describe('parseVizActions', () => {
  test('reads the actions field and drops malformed entries', () => {
    const data = {
      actions: [
        {
          id: 'a',
          label: 'A',
          icon: '',
          kind: 'chain',
          template: 'at {{#index}}',
        },
        { id: 'b' },
      ],
      kind: 'grid',
    }
    expect(parseVizActions(data).map((a) => a.id)).toEqual(['a'])
  })
  test('no field, a non-object or a malformed field gives none', () => {
    expect(parseVizActions({ kind: 'grid' })).toEqual([])
    expect(parseVizActions([1, 2])).toEqual([])
    expect(parseVizActions({ actions: 'no' })).toEqual([])
  })
})

describe('templates', () => {
  test('placeholder names, in order', () => {
    expect(placeholderNames('get_value {{@column}} {{#index}}')).toEqual(['column', 'index'])
  })
  test('# makes a number of a numeric value, text of any other', () => {
    expect(text(actionPattern(chain('at {{#index}}'), { index: '3' }))).toBe('operator1.at 3')
    expect(text(actionPattern(chain('at {{#key}}'), { key: 'a' }))).toBe("operator1.at 'a'")
  })
  test('@ keeps a number a number and text text', () => {
    expect(text(actionPattern(chain('read {{@t}}'), { t: '2' }))).toBe("operator1.read '2'")
    expect(text(actionPattern(chain('read {{@t}}'), { t: 2 }))).toBe('operator1.read 2')
  })
  test('a bare placeholder takes an expression', () => {
    const pattern = actionPattern(chain('filter {{@column}} {{condition}}'), {
      column: 'a',
      condition: (module) => Ast.parseExpression('(..Equal 3)', module)!,
    })
    expect(text(pattern)).toBe("operator1.filter 'a' (..Equal 3)")
  })
  test('* makes a vector', () => {
    expect(
      text(
        actionPattern(chain('remove_columns {{@columns*}}'), {
          columns: ['b', 'd'],
        }),
      ),
    ).toBe("operator1.remove_columns ['b', 'd']")
  })
  test('a missing value gives no pattern', () => {
    expect(actionPattern(chain('get_value {{@column}} {{#index}}'), { index: 2 })).toBeUndefined()
    expect(actionPattern(chain('at {{#index}}'), { index: null })).toBeUndefined()
    expect(actionPattern(chain('remove_columns {{@columns*}}'), { columns: 'b' })).toBeUndefined()
  })
  test('a new node names the node with {{node}}', () => {
    const action: VizAction = {
      ...chain('Thing.describe {{node}} {{#n}}'),
      kind: 'new_node',
    }
    expect(text(actionPattern(action, { n: 1 }))).toBe('Thing.describe operator1 1')
  })
  test('a new node without {{node}}, or a chain with it, gives no pattern', () => {
    expect(actionPattern({ kind: 'new_node', template: 'Date.today' })).toBeUndefined()
    expect(actionPattern(chain('f {{node}}'))).toBeUndefined()
  })
  test('a template that does not parse gives no pattern', () => {
    expect(actionPattern(chain('at (('), {})).toBeUndefined()
  })
})

describe('chains', () => {
  test('steps joined by the spaced dot, the first unspaced by default', () => {
    expect(text(chainPattern([{ code: "get 'tags'" }, { code: 'at 1' }]))).toBe(
      "operator1.get 'tags' . at 1",
    )
  })
  test('firstSpaced spaces the first dot too', () => {
    const step = { template: 'filter {{@column}} {{condition}}' }
    const pattern = chainPattern(
      [
        {
          ...step,
          values: {
            column: 'a',
            condition: (m) => Ast.parseExpression('(..Greater 1)', m)!,
          },
        },
        {
          ...step,
          values: {
            column: 'b',
            condition: (m) => Ast.parseExpression('..Is_Nothing', m)!,
          },
        },
      ],
      { firstSpaced: true },
    )
    expect(text(pattern)).toBe("operator1 . filter 'a' (..Greater 1) . filter 'b' ..Is_Nothing")
  })
  test('a literal step is not read for placeholders', () => {
    expect(text(chainPattern([{ code: "get '{{a}}'" }]))).toBe("operator1.get '{{a}}'")
  })
  test('no steps give no pattern', () => {
    expect(chainPattern([])).toBeUndefined()
  })
})

describe('plain actions', () => {
  test('a chain with no placeholder, or a new node with only {{node}}', () => {
    expect(isPlainAction(chain('remove_warnings'))).toBe(true)
    expect(isPlainAction({ ...chain('Thing.describe {{node}}'), kind: 'new_node' })).toBe(true)
    expect(isPlainAction(chain('at {{#index}}'))).toBe(false)
  })
})

describe('the templates Enso sends', () => {
  // The templates of `table_actions` (Viz_Helpers.enso) and the vector's and column's `at {{#index}}`
  // (Viz_Actions.enso).
  const sortByA = (module: Ast.MutableModule) =>
    Ast.parseExpression("(Sort_Column.Name 'a')", module)!
  const greaterThan = (module: Ast.MutableModule) => Ast.parseExpression('(..Greater 1)', module)!
  test('get_row', () => {
    expect(text(actionPattern(chain('get_row {{#index}}'), { index: 3 }))).toBe(
      'operator1.get_row 3',
    )
  })
  test('at by column', () => {
    expect(text(actionPattern(chain('at {{@column}}'), { column: 'a b' }))).toBe(
      "operator1.at 'a b'",
    )
  })
  test('get_value', () => {
    const action = chain('get_value {{@column}} {{#index}}')
    expect(text(actionPattern(action, { column: 'b', index: 2 }))).toBe("operator1.get_value 'b' 2")
  })
  test('sort, from expressions and from text', () => {
    const action = chain('sort {{columns*}}')
    expect(text(actionPattern(action, { columns: [sortByA, sortByA] }))).toBe(
      "operator1.sort [(Sort_Column.Name 'a'), (Sort_Column.Name 'a')]",
    )
    expect(text(actionPattern(action, { columns: ['a', 'b'] }))).toBe('operator1.sort [a, b]')
  })
  test('filter', () => {
    const action = chain('filter {{@column}} {{condition}}')
    expect(text(actionPattern(action, { column: 'a', condition: greaterThan }))).toBe(
      "operator1.filter 'a' (..Greater 1)",
    )
  })
  test('remove_columns and reorder_columns', () => {
    const remove = chain('remove_columns {{@columns*}}')
    expect(text(actionPattern(remove, { columns: ['b', 'd'] }))).toBe(
      "operator1.remove_columns ['b', 'd']",
    )
    const reorder = chain('reorder_columns {{@columns*}}')
    expect(text(actionPattern(reorder, { columns: ['d', 'b'] }))).toBe(
      "operator1.reorder_columns ['d', 'b']",
    )
  })
  test('brush_filter, with negative bounds and with numbers as text', () => {
    const action = chain('filter {{@column}} (..Between {{#min}} {{#max}})')
    const code = (min: string | number, max: string | number) =>
      text(actionPattern(action, { column: 'x', min, max }))
    expect(code(1, 5)).toBe("operator1.filter 'x' (..Between 1 5)")
    expect(code(-1.5, 5)).toBe("operator1.filter 'x' (..Between -1.5 5)")
    expect(code('-1', '5')).toBe("operator1.filter 'x' (..Between -1 5)")
  })
  test('brush_filter over tiny and huge bounds', () => {
    const action = chain('filter {{@column}} (..Between {{#min}} {{#max}})')
    const code = (min: number, max: number) =>
      text(actionPattern(action, { column: 'x', min, max }))
    expect(code(1e-7, 1e21)).toBe(
      "operator1.filter 'x' (..Between 0.0000001 1000000000000000000000)",
    )
    expect(code(-1.5e-9, 2.5e22)).toBe(
      "operator1.filter 'x' (..Between -0.0000000015 25000000000000000000000)",
    )
  })
  test('at by index, for a column and for a vector', () => {
    expect(text(actionPattern(chain('at {{#index}}'), { index: 4 }))).toBe('operator1.at 4')
  })
})

describe('text values', () => {
  test.each([
    ["it's"],
    ['a\\b'],
    ['a\\'],
    ['line one\nline two'],
    ['a`b'],
    ["a\\'b"],
    ['C:\\dir\\new'],
    ['say "hi"'],
  ])('%j survives being written as a text literal', (value) => {
    expect(textLiterals(actionPattern(chain('read {{@t}}'), { t: value }))).toEqual([value])
  })
  test('each element of a vector is escaped', () => {
    const columns = ["it's", 'a\\b', 'x\ny']
    const pattern = actionPattern(chain('remove_columns {{@columns*}}'), { columns })
    expect(textLiterals(pattern)).toEqual(columns)
  })
})

describe('values Enso cannot write', () => {
  const between = chain('filter {{@column}} (..Between {{#min}} {{#max}})')
  test.each([[NaN], [Infinity], [-Infinity]])('the number %s gives no pattern', (value) => {
    expect(actionPattern(chain('at {{#index}}'), { index: value })).toBeUndefined()
    expect(actionPattern(chain('read {{@t}}'), { t: value })).toBeUndefined()
    expect(actionPattern(between, { column: 'x', min: value, max: 1 })).toBeUndefined()
  })
  test("the text 'Infinity' read as a number gives no pattern, as text it is text", () => {
    expect(actionPattern(chain('at {{#index}}'), { index: 'Infinity' })).toBeUndefined()
    expect(text(actionPattern(chain('read {{@t}}'), { t: 'Infinity' }))).toBe(
      "operator1.read 'Infinity'",
    )
  })
  test('an empty or unparsable expression gives no pattern', () => {
    expect(actionPattern(chain('filter {{condition}}'), { condition: '' })).toBeUndefined()
    expect(actionPattern(chain('filter {{condition}}'), { condition: '((' })).toBeUndefined()
  })
  test('one unwritable element of a vector gives no pattern', () => {
    expect(actionPattern(chain('f {{#xs*}}'), { xs: [1, NaN, 3] })).toBeUndefined()
  })
  test('one unwritable step of a chain gives no pattern', () => {
    const steps = [
      { template: 'at {{#i}}', values: { i: 1 } },
      { template: 'at {{#i}}', values: { i: NaN } },
    ]
    expect(chainPattern(steps)).toBeUndefined()
  })
})

describe('templates the builder cannot fill', () => {
  test('a placeholder inside quotes gives no pattern', () => {
    expect(actionPattern(chain("f '{{@a}}'"), { a: 'x' })).toBeUndefined()
  })
  test('{{node}} twice gives no pattern, before any node is created', () => {
    const action: VizAction = { ...chain('f {{node}} {{node}}'), kind: 'new_node' }
    expect(actionPattern(action)).toBeUndefined()
  })
  test('names that Object has are values like any other', () => {
    expect(actionPattern(chain('f {{toString}}'), {})).toBeUndefined()
    expect(actionPattern(chain('f {{@constructor}}'), {})).toBeUndefined()
    expect(actionPattern(chain('f {{#hasOwnProperty}}'), {})).toBeUndefined()
    expect(text(actionPattern(chain('f {{@toString}}'), { toString: 'a' }))).toBe("operator1.f 'a'")
  })
  test('a code step that holds the placeholder identifier gives no pattern', () => {
    expect(chainPattern([{ code: 'f __' }])).toBeUndefined()
  })
})

describe('empty vectors', () => {
  test('an empty vector is not a filled value', () => {
    expect(actionPattern(chain('remove_columns {{@columns*}}'), { columns: [] })).toBeUndefined()
    expect(actionPattern(chain('sort {{columns*}}'), { columns: [] })).toBeUndefined()
  })
})

describe('findAction', () => {
  const actions = [chain('a'), { ...chain('b {{#i}}'), id: 'second' }]
  test('finds an action by its id', () => {
    expect(findAction(actions, 'second')?.template).toBe('b {{#i}}')
  })
  test('gives nothing for an id the value does not offer', () => {
    expect(findAction(actions, 'nope')).toBeUndefined()
    expect(findAction([], 'x')).toBeUndefined()
  })
})

describe('more plain actions, chains and parsing', () => {
  test('a new node with no {{node}}, or with another placeholder, is not plain', () => {
    expect(isPlainAction({ ...chain('Date.today'), kind: 'new_node' })).toBe(false)
    expect(isPlainAction({ ...chain('f {{node}} {{#n}}'), kind: 'new_node' })).toBe(false)
  })
  test('a code step and a template step mix in one chain', () => {
    const pattern = chainPattern([
      { code: "get 'tags'" },
      { template: 'at {{#i}}', values: { i: 1 } },
    ])
    expect(text(pattern)).toBe("operator1.get 'tags' . at 1")
  })
  test('a null or non-list actions field gives none, and a bad kind is dropped', () => {
    expect(parseVizActions({ actions: null })).toEqual([])
    expect(parseVizActions(null)).toEqual([])
    const good = { id: 'a', label: 'A', icon: '', kind: 'chain', template: 't' }
    const data = { actions: [{ ...good, kind: 'other' }, { ...good, extra: 1 }, 7] }
    expect(parseVizActions(data)).toEqual([good])
  })
})

describe('plainActionToolbar', () => {
  test('a button per plain action, creating its node', () => {
    const actions: VizAction[] = [
      {
        id: 'remove_warnings',
        label: 'Remove Warnings',
        icon: 'not_exclamation',
        kind: 'chain',
        template: 'remove_warnings',
      },
      {
        id: 'open_row',
        label: 'Get Row',
        icon: 'select_row',
        kind: 'chain',
        template: 'get_row {{#index}}',
      },
    ]
    const created: string[] = []
    const items = plainActionToolbar(actions, (...options: NodeCreationOptions[]) =>
      options.forEach((option) => created.push(text(option.content)!)),
    )
    expect(items).toHaveLength(1)
    const [button] = items
    if (button == null || !isActionButton(button)) throw new Error('not a button')
    expect(button.title).toBe('Remove Warnings')
    expect(button.dataTestid).toBe('remove-warnings-button')
    button.onClick()
    expect(created).toEqual(['operator1.remove_warnings'])
  })

  test('an icon the IDE does not know is left out, and a disabled rule is passed on', () => {
    const action = (icon: string): VizAction => ({
      id: 'a_b',
      label: 'A',
      icon,
      kind: 'chain',
      template: 'a_b',
    })
    const [known, unknown] = plainActionToolbar(
      [action('not_exclamation'), action('no such icon')],
      () => {},
      (a) => a.icon === 'no such icon',
    )
    if (known == null || unknown == null || !isActionButton(known) || !isActionButton(unknown))
      throw new Error('not buttons')
    expect(known.icon).toBe('not_exclamation')
    expect(unknown.icon).toBeUndefined()
    expect(known.disabled).toBe(false)
    expect(unknown.disabled).toBe(true)
    expect(known.dataTestid).toBe('a-b-button')
  })
})
