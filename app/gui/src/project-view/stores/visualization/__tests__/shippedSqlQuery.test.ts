/** @file The SQL Query visualization that Standard.Database ships. */
import { mount } from '@vue/test-utils'
import { afterEach, expect, test, vi } from 'vitest'
import * as SqlQuery from '../../../../../../../distribution/lib/Standard/Database/0.0.0-dev/visualizations/SQL_Query.vue'

const TEXT = 'Standard.Base.Data.Text.Text'
const NO_SQL = { error: 'This value has no SQL to show.' }

function sql(code: string, ...values: unknown[]) {
  return {
    data: {
      dialect: 'SQLite',
      code,
      // eslint-disable-next-line camelcase -- The field name is the Enso side's.
      interpolations: values.map((value) => ({ enso_type: TEXT, value })),
    },
  }
}

afterEach(() => {
  document.body.innerHTML = ''
})

test('it is the SQL Query view of database tables and columns', () => {
  expect(SqlQuery.name).toBe('SQL Query')
  expect(SqlQuery.inputType).toBe(
    'Standard.Database.DB_Table.DB_Table | Standard.Database.DB_Column.DB_Column',
  )
  expect(SqlQuery.defaultPreprocessor).toEqual([
    'Standard.Visualization.SQL.Visualization',
    'prepare_visualization',
  ])
})

test('formats the SQL and colours each interpolated value by its type', () => {
  const wrapper = mount(SqlQuery.default, {
    props: sql('SELECT "a" FROM "t" WHERE "b" = ?', "it's"),
  })
  const pre = wrapper.get('pre.sql')
  expect(pre.text()).toContain('\n')
  expect(pre.text().replace(/\s+/g, ' ')).toBe(`SELECT "a" FROM "t" WHERE "b" = 'it''s'`)
  const value = pre.get('.interpolation')
  expect(value.text()).toBe("'it''s'")
  expect(value.attributes('style')).toMatch(/color:\s*rgba\(/)
})

test('shows the error text when there is no SQL', () => {
  const wrapper = mount(SqlQuery.default, { props: { data: NO_SQL } })
  expect(wrapper.get('pre.sql').text()).toBe(NO_SQL.error)
})

test('Ctrl+C copies the selected SQL instead of reaching the graph editor', async () => {
  const graph = vi.fn()
  document.body.addEventListener('keydown', graph)
  const wrapper = mount(SqlQuery.default, {
    props: { data: NO_SQL },
    attachTo: document.body,
  })
  await wrapper.get('.SQLVisualization').trigger('keydown', { key: 'c', ctrlKey: true })
  expect(graph).not.toHaveBeenCalled()
  await wrapper.get('.SQLVisualization').trigger('keydown', { key: 'v', ctrlKey: true })
  expect(graph).toHaveBeenCalledTimes(1)
  wrapper.unmount()
  document.body.removeEventListener('keydown', graph)
})

test('markup in a value or in the code is shown as text', () => {
  const wrapper = mount(SqlQuery.default, {
    props: sql(`SELECT '<i>y</i>' AS "x" WHERE "b" = ?`, '<b>bold</b>'),
  })
  const pre = wrapper.get('pre.sql')
  expect(pre.find('i').exists()).toBe(false)
  expect(pre.find('b').exists()).toBe(false)
  expect(pre.text()).toContain(`'<i>y</i>'`)
  expect(pre.get('.interpolation').text()).toBe(`'<b>bold</b>'`)
})

test('a Text value gets the colour its type name hashes to', () => {
  const wrapper = mount(SqlQuery.default, { props: sql('SELECT ?', 'a') })
  // What the GUI's former DEFAULT_THEME computed for 'Standard.Base.Data.Text.Text'.
  const style = wrapper.get('.interpolation').attributes('style')
  expect(style).toContain('color:rgba(52.4609375,106.25,37.1875,1);')
  expect(style).toContain('background-color:rgba(52.4609375,106.25,37.1875,0.2);')
})

test('a placeholder-looking name in the SQL is shown as it is', () => {
  const wrapper = mount(SqlQuery.default, {
    props: sql('SELECT __enso_param_7__ FROM "t" WHERE "b" = ?', 'x'),
  })
  const pre = wrapper.get('pre.sql')
  expect(pre.text()).toContain('__enso_param_7__')
  expect(pre.get('.interpolation').text()).toBe("'x'")
})

test('a placeholder-looking name in the SQL that matches a value is still shown as it is', () => {
  const wrapper = mount(SqlQuery.default, {
    props: sql('SELECT __enso_param_0__ WHERE "b" = ?', 'x'),
  })
  const pre = wrapper.get('pre.sql')
  expect(pre.text().replace(/\s+/g, ' ')).toContain('SELECT __enso_param_0__')
  expect(pre.findAll('.interpolation')).toHaveLength(1)
})

// === Syntax colouring ===

/** The text of each coloured token of one kind in the mounted view. */
function tokens(code: string, kind: string, ...values: unknown[]) {
  const wrapper = mount(SqlQuery.default, { props: sql(code, ...values) })
  return wrapper
    .get('pre.sql')
    .findAll(`.tok-${kind}`)
    .map((t) => t.text())
}

test('keywords are coloured, whatever their case', () => {
  expect(tokens('SELECT a FROM t WHERE a IS NOT NULL', 'keyword')).toEqual([
    'SELECT',
    'FROM',
    'WHERE',
    'IS',
    'NOT',
    'NULL',
  ])
  // sql-formatter leaves a lower-case keyword as it was; it is a keyword all the same.
  expect(tokens('select a from t where a is null', 'keyword')).toEqual([
    'select',
    'from',
    'where',
    'is',
    'null',
  ])
})

test('a word that only contains a keyword is not one', () => {
  expect(tokens('SELECT selection, fromage, "order" FROM t', 'keyword')).toEqual(['SELECT', 'FROM'])
})

test('a function name is not a keyword', () => {
  expect(tokens('SELECT COUNT(a), MAX(b) FROM t', 'keyword')).toEqual(['SELECT', 'FROM'])
})

test('string literals are coloured, a doubled quote staying inside', () => {
  expect(tokens(`SELECT 'it''s', 'b' FROM t`, 'string')).toEqual([`'it''s'`, `'b'`])
})

test('a string holding -- or a keyword is one string token', () => {
  expect(tokens(`SELECT 'a -- b', 'SELECT FROM' FROM t`, 'string')).toEqual([
    `'a -- b'`,
    `'SELECT FROM'`,
  ])
  expect(tokens(`SELECT 'a -- b', 'SELECT FROM' FROM t`, 'comment')).toEqual([])
  expect(tokens(`SELECT 'a -- b', 'SELECT FROM' FROM t`, 'keyword')).toEqual(['SELECT', 'FROM'])
})

test('quoted identifiers are coloured, whatever their quotes', () => {
  expect(tokens('SELECT "a b", `c` FROM t', 'identifier')).toEqual(['"a b"', '`c`'])
  // sql-formatter reads [..] only in the T-SQL dialect.
  const wrapper = mount(SqlQuery.default, {
    props: { data: { ...sql('SELECT [a b] FROM t').data, dialect: 'transactsql' } },
  })
  expect(wrapper.get('pre.sql').get('.tok-identifier').text()).toBe('[a b]')
})

test('a quoted identifier holding a keyword or a quote is one token', () => {
  expect(tokens(`SELECT "FROM 'x'" FROM t`, 'identifier')).toEqual([`"FROM 'x'"`])
  expect(tokens(`SELECT "FROM 'x'" FROM t`, 'string')).toEqual([])
})

test('numbers are coloured', () => {
  expect(tokens('SELECT 1, 2.5, 0.5, 1e10, 3.2E-4 FROM t LIMIT 10', 'number')).toEqual([
    '1',
    '2.5',
    '0.5',
    '1e10',
    '3.2E-4',
    '10',
  ])
})

test('a digit inside a name is not a number', () => {
  expect(tokens('SELECT col1, t2.x3 FROM t2', 'number')).toEqual([])
})

test('comments are coloured, to the end of the line or to the closing mark', () => {
  // The formatter re-indents the second line of a block comment, so compare the words.
  const comments = tokens('SELECT a -- the a\nFROM t /* from\nhere */ WHERE b', 'comment')
  expect(comments.map((c) => c.replace(/\s+/g, ' '))).toEqual(['-- the a', '/* from here */'])
})

test('a comment holding a quote is one comment', () => {
  const code = `SELECT a -- it's\nFROM t /* "x" ' */`
  expect(tokens(code, 'comment')).toEqual(["-- it's", `/* "x" ' */`])
  expect(tokens(code, 'string')).toEqual([])
  expect(tokens(code, 'identifier')).toEqual([])
})

test('operators and punctuation keep the default colour', () => {
  const wrapper = mount(SqlQuery.default, { props: sql('SELECT (a + b) * 2 FROM t') })
  const pre = wrapper.get('pre.sql')
  const coloured = pre.findAll('[class^="tok-"]').map((t) => t.text())
  expect(coloured).toEqual(['SELECT', '2', 'FROM'])
})

test('a value that looks like SQL stays an uncoloured chip', () => {
  const wrapper = mount(SqlQuery.default, {
    props: sql('SELECT a FROM t WHERE b = ? AND c = ?', "SELECT 'x' -- y", 42),
  })
  const chips = wrapper.get('pre.sql').findAll('.interpolation')
  expect(chips).toHaveLength(2)
  for (const chip of chips) expect(chip.find('[class^="tok-"]').exists()).toBe(false)
  expect(chips[0]!.text()).toBe(`'SELECT ''x'' -- y'`)
  // Nothing of the value leaked into the tokens around it.
  expect(tokens('SELECT a FROM t WHERE b = ?', 'string', "SELECT 'x'")).toEqual([])
  expect(tokens('SELECT a FROM t WHERE b = ?', 'keyword', 'FROM')).toEqual([
    'SELECT',
    'FROM',
    'WHERE',
  ])
})

test('a quote in a value does not begin a string in the SQL after it', () => {
  expect(tokens(`SELECT a FROM t WHERE b = ? AND c = 'z'`, 'string', "it's")).toEqual([`'z'`])
})

test('markup in a coloured token is shown as text', () => {
  const wrapper = mount(SqlQuery.default, {
    props: sql(`SELECT '<i>y</i>', "<b>q</b>" -- <u>c</u>\nFROM t`),
  })
  const pre = wrapper.get('pre.sql')
  for (const tag of ['i', 'b', 'u']) expect(pre.find(tag).exists()).toBe(false)
  expect(pre.get('.tok-string').text()).toBe(`'<i>y</i>'`)
  expect(pre.get('.tok-identifier').text()).toBe('"<b>q</b>"')
  expect(pre.get('.tok-comment').text()).toBe('-- <u>c</u>')
})

test('the placeholder guard holds while colouring', () => {
  const wrapper = mount(SqlQuery.default, {
    props: sql(`SELECT __enso_param_0__, '__enso_param_0__' FROM t WHERE b = ?`, 'x'),
  })
  const pre = wrapper.get('pre.sql')
  expect(pre.findAll('.interpolation')).toHaveLength(1)
  expect(pre.get('.tok-string').text()).toBe(`'__enso_param_0__'`)
  expect(pre.text().replace(/\s+/g, ' ')).toContain('SELECT __enso_param_0__')
})
