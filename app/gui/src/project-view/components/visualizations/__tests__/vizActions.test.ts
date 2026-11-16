/** @file Tests for the node action builder. */
import { Ast } from '@/util/ast'
import type { Pattern } from '@/util/ast/match'
import { describe, expect, test } from 'vitest'
import {
  actionPattern,
  chainPattern,
  isPlainAction,
  parseVizActions,
  placeholderNames,
  type VizAction,
} from '../vizActions'

function text(pattern: Pattern | undefined) {
  return pattern?.instantiateCopied([Ast.parseExpression('operator1')!]).code()
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
