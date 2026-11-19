import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  edgesNotDownward,
  overlappingPairs,
  stripDocumentation,
  type GraphNode,
} from '../../mcp-eval/checkHelpers'
import { TASK_IDS, TASKS } from '../../mcp-eval/tasks'
import {
  EXPECTED_PRODUCTS as CSV_PRODUCTS,
  EXPECTED_TOTALS as CSV_TOTALS,
} from '../../mcp-eval/tasks/csv-pipeline/task'
import {
  customersCsv,
  generateCustomers,
  generateOrders,
  generateSales,
  ordersCsv,
  ordersOf2024Joiners,
  PRODUCTS,
  REGIONS,
  revenueByProduct,
  salesCsv,
} from '../../mcp-eval/tasks/data'
import {
  EXPECTED_PRODUCTS as FIX_PRODUCTS,
  EXPECTED_TOTALS as FIX_TOTALS,
} from '../../mcp-eval/tasks/fix-error/task'
import { fixtureFiles, nodeId } from '../../mcp-eval/tasks/generateFixtures'
import { EXPECTED_TOTALS as JOIN_TOTALS } from '../../mcp-eval/tasks/join/task'
import { withNodeMetadata, withoutMetadata } from '../../mcp-eval/tasks/metadata'
import { LAYOUT_MAIN, LAYOUT_NODES } from '../../mcp-eval/tasks/sources'

const TASKS_DIR = path.join(import.meta.dirname, '..', '..', 'mcp-eval', 'tasks')

describe('the task set', () => {
  test('is the seven tasks of the spec, each with a prompt, checks and a fixture', () => {
    expect(TASK_IDS).toEqual([
      'csv-pipeline',
      'fix-error',
      'document',
      'layout',
      'visualize',
      'join',
      'refactor',
    ])
    for (const task of TASKS) {
      expect(task.prompt.length, task.id).toBeGreaterThan(40)
      expect(
        task.checks.some((c) => c.discriminating),
        `${task.id} has a discriminating check`,
      ).toBe(true)
      expect(fs.existsSync(path.join(TASKS_DIR, task.id, 'project', 'src', 'Main.enso'))).toBe(true)
      expect(fs.existsSync(path.join(TASKS_DIR, task.id, 'solution', 'src', 'Main.enso'))).toBe(
        true,
      )
    }
  })
  test('a prompt never names a component to use', () => {
    for (const task of TASKS) {
      expect(task.prompt, task.id).not.toMatch(
        /\b(aggregate|join|filter|order_by|collapse|add_nodes|set_visualization)\b/i,
      )
    }
  })
})

describe('the committed fixtures', () => {
  test('are exactly what generateFixtures.ts writes (run writeFixtures.ts after a change)', () => {
    for (const [file, content] of fixtureFiles()) {
      const committed = fs.readFileSync(path.join(TASKS_DIR, file), 'utf8')
      expect(committed.replace(/\r\n/g, '\n'), file).toBe(content)
    }
  })
})

describe('the expected values', () => {
  const sales = generateSales()
  test('the data is 500 sales over 2 years, every region and product', () => {
    expect(sales).toHaveLength(500)
    expect(new Set(sales.map((s) => s.region))).toEqual(new Set(REGIONS))
    expect(new Set(sales.map((s) => s.product))).toEqual(new Set(PRODUCTS))
    expect(new Set(sales.map((s) => s.date.slice(0, 4)))).toEqual(new Set(['2024', '2025']))
    expect(salesCsv(sales).trim().split('\n')).toHaveLength(501)
  })
  test('csv-pipeline: North 2025, six products, no ties', () => {
    const rows = revenueByProduct(sales, 'North', 2025)
    expect(rows.map((r) => r.product)).toEqual(CSV_PRODUCTS)
    expect(rows.map((r) => r.total)).toEqual(CSV_TOTALS)
    expect(new Set(CSV_TOTALS).size).toBe(6)
  })
  test('fix-error: North over both years', () => {
    const rows = revenueByProduct(sales, 'North', undefined)
    expect(rows.map((r) => r.product)).toEqual(FIX_PRODUCTS)
    expect(rows.map((r) => r.total)).toEqual(FIX_TOTALS)
  })
  test('join: every region has 2024 joiners, and the West has nothing to total', () => {
    const customers = generateCustomers()
    const orders = generateOrders(customers)
    expect(ordersOf2024Joiners(customers, orders)).toEqual(JOIN_TOTALS)
    expect(Object.keys(JOIN_TOTALS)).toHaveLength(4)
    expect(JOIN_TOTALS.West).toBe(0)
    expect(customersCsv(customers).split('\n')[0]).toBe('id,region,joined')
    expect(ordersCsv(orders).split('\n')[0]).toBe('customer_id,amount')
  })
})

describe('node metadata', () => {
  const code = 'main =\n    a = 10\n    b = a + 1\n    b\n'
  test('maps each statement’s expression to an id and stores the position', () => {
    const text = withNodeMetadata(
      code,
      [
        { name: 'a', position: [1, 2] },
        { name: 'b', position: [3, 4], visualization: { name: 'Scatter Plot', width: 500 } },
      ],
      nodeId,
    )
    expect(withoutMetadata(text)).toBe(code + '\n\n\n')
    const [idMap, metadata] = text.split('#### METADATA ####\n')[1]!.trim().split('\n')
    const spans = JSON.parse(idMap!) as [
      { index: { value: number }; size: { value: number } },
      string,
    ][]
    expect(spans.map(([s]) => code.slice(s.index.value, s.index.value + s.size.value))).toEqual([
      '10',
      'a + 1',
    ])
    const stored = JSON.parse(metadata!).ide.node
    expect(stored[spans[0]![1]].position.vector).toEqual([1, 2])
    expect(stored[spans[1]![1]].visualization).toMatchObject({
      show: true,
      name: 'Scatter Plot',
      width: 500,
    })
  })
  test('refuses a name that is not exactly one statement', () => {
    expect(() => withNodeMetadata(code, [{ name: 'zz', position: [0, 0] }])).toThrow('exactly one')
  })
  test('ids are reproducible', () => {
    expect(nodeId('n1')).toBe(nodeId('n1'))
    expect(nodeId('n1')).not.toBe(nodeId('n2'))
    expect(nodeId('n1')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})

describe('the layout fixture', () => {
  test('keeps the same code in the start and the solution', () => {
    const files = fixtureFiles()
    const start = stripDocumentation(files.get('layout/project/src/Main.enso')!)
    expect(start).toBe(stripDocumentation(LAYOUT_MAIN))
    expect(stripDocumentation(files.get('layout/solution/src/Main.enso')!)).toBe(start)
  })
  test('its flow runs n1 to n12 (every input is an earlier node)', () => {
    const nodes: GraphNode[] = LAYOUT_NODES.map((name, i) => ({
      id: name,
      name,
      code: new RegExp(`^ +${name} = (.+)$`, 'm').exec(LAYOUT_MAIN)![1]!,
      position: { x: 0, y: i * 72 },
      area: { x: 0, y: i * 72, width: 100, height: 32 },
    }))
    expect(edgesNotDownward(nodes)).toEqual([])
    expect(overlappingPairs(nodes)).toEqual([])
    // Reversed, every edge goes up.
    const reversed = nodes.map((n, i) => ({ ...n, position: { x: 0, y: (11 - i) * 72 } }))
    expect(edgesNotDownward(reversed).length).toBeGreaterThan(0)
  })
})
