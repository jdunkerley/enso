/** @file Tests for the guides an agent reads before it works (`src/mcp/guides.ts`). */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { Guides, guideTool, guideUri } from '../../src/mcp/guides'

let root: string

function write(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-guides-'))
  write(path.join(root, 'CLAUDE.md'), '# Stdlib top level')
  write(path.join(root, 'Base', '0.0.0-dev', 'CLAUDE.md'), '# Base guide')
  write(path.join(root, 'Table', '0.0.0-dev', 'CLAUDE.md'), '# Table guide')
  fs.mkdirSync(path.join(root, 'Empty', '0.0.0-dev'), { recursive: true })
})

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

const topics = async (guides: Guides) => (await guides.list()).map((guide) => guide.topic)

describe('Guides', () => {
  test('lists the built-in topics, then the stdlib and each library with a guide', async () => {
    expect(await topics(new Guides(root))).toEqual([
      'overview',
      'language',
      'data-pitfalls',
      'stdlib',
      'library/Base',
      'library/Table',
    ])
  })

  test('lists only the built-in topics without a bundled standard library', async () => {
    expect(await topics(new Guides(undefined))).toEqual(['overview', 'language', 'data-pitfalls'])
  })

  test('reads library and stdlib guides from disk', async () => {
    const guides = new Guides(root)
    expect(await guides.read('library/Base')).toBe('# Base guide')
    expect(await guides.read('stdlib')).toBe('# Stdlib top level')
  })

  test('refuses unknown topics and path traversal', async () => {
    const guides = new Guides(root)
    expect(await guides.read('library/../../etc')).toBeUndefined()
    expect(await guides.read('library/Nope')).toBeUndefined()
    expect(await guides.read('library/Empty')).toBeUndefined()
    expect(await guides.read('nonsense')).toBeUndefined()
    expect(await new Guides(undefined).read('stdlib')).toBeUndefined()
  })

  test('built-in guides mention the tools they teach', async () => {
    const guides = new Guides(undefined)
    expect(await guides.read('overview')).toContain('get_graph')
    expect(guides.instructions).toContain('get_guide')
  })

  test('guideUri names the topic', () => {
    expect(guideUri('library/Base')).toBe('enso://guide/library/Base')
  })
})

describe('guideTool', () => {
  const caller = { name: 'test' } as never

  test('without a topic returns the overview and the topic list', async () => {
    const tool = guideTool(new Guides(root))
    expect(tool.name).toBe('get_guide')
    const result = await tool.run({}, caller)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toContain('get_graph')
      expect(result.value).toContain('library/Base')
    }
  })

  test('returns the requested topic', async () => {
    const result = await guideTool(new Guides(root)).run({ topic: 'library/Table' }, caller)
    expect(result).toEqual({ ok: true, value: '# Table guide' })
  })

  test('an unknown topic fails and lists the valid ones', async () => {
    const result = await guideTool(new Guides(root)).run({ topic: 'nope' }, caller)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('overview')
  })
})
