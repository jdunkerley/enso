import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import {
  areasOverlap,
  dataFlowEdges,
  diffTrees,
  edgesNotDownward,
  findDryRunFiles,
  findNumericColumn,
  findTextColumn,
  forbiddenChanges,
  hashTree,
  keyedTotalsProblem,
  numbersMatch,
  overlappingPairs,
  parseColumns,
  parseGraph,
  stripDocumentation,
  type GraphNode,
} from '../../mcp-eval/checkHelpers'
import { commonChecks } from '../../mcp-eval/task'

const node = (name: string, code: string, x = 0, y = 0, w = 100, h = 30): GraphNode => ({
  id: name,
  name,
  code,
  position: { x, y },
  area: { x, y, width: w, height: h },
})

describe('finding a column by its values', () => {
  const columns = parseColumns(
    JSON.stringify([
      ['whatever', ['b', 'a']],
      ['other', [1.004, 2]],
    ]),
  )
  test('a text column, by its values in order, whatever its name', () => {
    expect(findTextColumn(columns, ['b', 'a'])).toBe(0)
    expect(findTextColumn(columns, ['a', 'b'])).toBe(-1)
  })
  test('a numeric column within a tolerance', () => {
    expect(findNumericColumn(columns, [1, 2])).toBe(1)
    expect(findNumericColumn(columns, [1.1, 2])).toBe(-1)
    expect(findNumericColumn(columns, [1, 2, 3])).toBe(-1)
  })
  test('numbersMatch can count a missing total as 0', () => {
    expect(numbersMatch([null, 2], [0, 2], 0.01, true)).toBe(true)
    expect(numbersMatch([null, 2], [0, 2])).toBe(false)
  })
  test('parseColumns refuses what is not a table', () => {
    expect(() => parseColumns('"Error: no such column"')).toThrow('not a table')
    expect(() => parseColumns('Method `x` could not be found')).toThrow('not a table')
  })
})

describe('keyedTotalsProblem', () => {
  const expected = { North: 10, West: 0 }
  test('accepts the keys in any order with a null total for a zero', () => {
    const columns = parseColumns(
      JSON.stringify([
        ['r', ['West', 'North']],
        ['t', [null, 10.004]],
      ]),
    )
    expect(keyedTotalsProblem(columns, expected)).toBeUndefined()
  })
  test('says which part is wrong', () => {
    const missing = parseColumns(
      JSON.stringify([
        ['r', ['North']],
        ['t', [10]],
      ]),
    )
    expect(keyedTotalsProblem(missing, expected)).toContain('no column holds exactly the keys')
    const wrong = parseColumns(
      JSON.stringify([
        ['r', ['North', 'West']],
        ['t', [10, 5]],
      ]),
    )
    expect(keyedTotalsProblem(wrong, expected)).toContain('no numeric column')
  })
})

describe('layout checks', () => {
  test('overlap: touching edges do not count, a shared area does', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 }
    expect(areasOverlap(a, { x: 10, y: 0, width: 10, height: 10 })).toBe(false)
    expect(areasOverlap(a, { x: 9, y: 9, width: 10, height: 10 })).toBe(true)
  })
  test('overlappingPairs names the pairs and skips a node with no area', () => {
    const nodes = [
      node('a', '1', 0, 0),
      node('b', '2', 50, 10),
      node('c', '3', 0, 100),
      { id: 'd', name: 'd', code: '' },
    ]
    expect(overlappingPairs(nodes)).toEqual([['a', 'b']])
  })
  test('edges come from a node’s code using another node’s name', () => {
    const nodes = [
      node('n1', '10'),
      node('n2', 'n1 + 1'),
      node('n10', 'n2 * 2'),
      node('x', "'n1' + Main.n2"),
    ]
    expect(dataFlowEdges(nodes).map(([a, b]) => `${a.name}>${b.name}`)).toEqual(['n1>n2', 'n2>n10'])
  })
  test('a consumer must be strictly below its input', () => {
    const good = [node('a', '1', 0, 0), node('b', 'a', 0, 80)]
    expect(edgesNotDownward(good)).toEqual([])
    const upward = [node('a', '1', 0, 80), node('b', 'a', 0, 0)]
    expect(edgesNotDownward(upward)).toEqual([['a', 'b']])
    const level = [node('a', '1', 0, 0), node('b', 'a', 50, 0)]
    expect(edgesNotDownward(level)).toEqual([['a', 'b']])
  })
})

describe('stripDocumentation', () => {
  test('removes doc comments with their indented lines, the metadata and blank lines', () => {
    const documented = [
      'import X',
      '',
      '## Summary.',
      '',
      '   ## Arguments',
      '   - `text`: the text',
      'clean text =',
      '    ## a node comment',
      '    text.trim',
      '',
      '#### METADATA ####',
      '[[]]',
    ].join('\n')
    const plain = ['import X', 'clean text =', '    text.trim'].join('\n')
    expect(stripDocumentation(documented)).toBe(plain)
    expect(stripDocumentation(plain)).toBe(plain)
  })
  test('a changed line shows', () => {
    expect(stripDocumentation('a = 1\n')).not.toBe(stripDocumentation('a = 2\n'))
  })
})

describe('parseGraph', () => {
  test('reads the nodes and refuses another shape', () => {
    expect(parseGraph(JSON.stringify({ method: 'main', source: 's', nodes: [] })).nodes).toEqual([])
    expect(() => parseGraph('{}')).toThrow('unexpected shape')
    expect(() => parseGraph('oops')).toThrow('did not answer JSON')
  })
})

describe('project files', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
  })
  const project = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-eval-test-'))
    dirs.push(dir)
    fs.mkdirSync(path.join(dir, 'src'))
    fs.mkdirSync(path.join(dir, 'data'))
    fs.mkdirSync(path.join(dir, '.enso'))
    fs.writeFileSync(path.join(dir, 'src', 'Main.enso'), 'main = 1')
    fs.writeFileSync(path.join(dir, 'data', 'a.csv'), 'x')
    fs.writeFileSync(path.join(dir, '.enso', 'index'), 'x')
    return dir
  }
  test('the module and images may change; data, other files and removals may not', () => {
    const dir = project()
    const before = hashTree(dir)
    expect([...before.keys()].sort()).toEqual(['data/a.csv', 'src/Main.enso'])
    fs.writeFileSync(path.join(dir, 'src', 'Main.enso'), 'main = 2')
    fs.mkdirSync(path.join(dir, 'images'))
    fs.writeFileSync(path.join(dir, 'images', 'p.png'), 'png')
    fs.writeFileSync(path.join(dir, '.enso', 'index'), 'changed')
    expect(forbiddenChanges(diffTrees(before, hashTree(dir)))).toEqual([])
    fs.writeFileSync(path.join(dir, 'data', 'a.csv'), 'changed')
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'new')
    fs.rmSync(path.join(dir, 'package.yaml'), { force: true })
    expect(forbiddenChanges(diffTrees(before, hashTree(dir))).sort()).toEqual([
      'data/a.csv',
      'notes.txt',
    ])
  })
  test('a deleted file is a forbidden change', () => {
    const dir = project()
    const before = hashTree(dir)
    fs.rmSync(path.join(dir, 'data', 'a.csv'))
    expect(forbiddenChanges(diffTrees(before, hashTree(dir)))).toEqual(['data/a.csv'])
  })
  test('finds dry-run files by name, at any depth', () => {
    const dir = project()
    fs.writeFileSync(path.join(dir, 'data', 'out_ensodryrun123.csv'), 'x')
    expect(findDryRunFiles([dir, path.join(dir, 'missing')])).toEqual([
      path.join(dir, 'data', 'out_ensodryrun123.csv'),
    ])
  })
})

describe('commonChecks', () => {
  test('all pass for a clean run that ended by itself, and for a self-check', () => {
    for (const ended of ['done', 'self-check'] as const) {
      const results = commonChecks({ ended, forbiddenFileChanges: [], dryRunFiles: [] })
      expect(results.every((r) => r.passed)).toBe(true)
    }
  })
  test('a cap, a forbidden file and a dry-run file each fail their own check', () => {
    const results = commonChecks({
      ended: 'turn-cap',
      forbiddenFileChanges: ['data/a.csv'],
      dryRunFiles: ['x_ensodryrun1.csv'],
    })
    expect(results.filter((r) => !r.passed)).toHaveLength(3)
    expect(results.map((r) => r.detail ?? '').join(' ')).toContain('turn-cap')
  })
})
