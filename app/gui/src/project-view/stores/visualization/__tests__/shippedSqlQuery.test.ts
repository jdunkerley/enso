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
