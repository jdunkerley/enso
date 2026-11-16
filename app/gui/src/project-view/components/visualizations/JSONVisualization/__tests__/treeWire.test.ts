import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { pinnedDir } from '../../__tests__/pinnedGoldens'
import { parsePageResult, parsePrepared } from '../treeWire'

describe('parsePrepared', () => {
  test('reads a branch root with its first page', () => {
    const data = {
      root: { kind: 'object', size: 1, label: '{1 key}' },
      children: {
        start: 0,
        size: 1,
        entries: [{ key: 'a', kind: 'leaf', value: 1, expr: ".get 'a'" }],
      },
    }
    expect(parsePrepared(data)).toEqual(data)
  })

  test('reads a leaf root', () => {
    expect(parsePrepared({ root: { kind: 'leaf', value: null } })).toEqual({
      root: { kind: 'leaf', value: null },
    })
  })

  test('rejects anything else', () => {
    expect(parsePrepared({ axis: {} })).toBeUndefined()
    expect(parsePrepared({ root: { kind: 'object', size: 1, label: '{1 key}' } })).toBeUndefined()
    expect(parsePrepared('text')).toBeUndefined()
  })
})

describe('parsePageResult', () => {
  test('reads a page', () => {
    const page = {
      start: 100,
      size: 250,
      entries: [{ key: 100, kind: 'array', size: 2, label: '[2 items]', expr: null }],
    }
    expect(parsePageResult(page)).toEqual({ ok: true, page })
  })

  test('reads an error', () => {
    expect(parsePageResult({ error: 'No child has the key x.' })).toEqual({
      ok: false,
      message: 'No child has the key x.',
    })
  })

  test('reports unexpected data', () => {
    expect(parsePageResult(42)).toEqual({
      ok: false,
      message: 'unexpected data',
    })
  })
})

describe('the pinned Enso goldens', () => {
  const pinned = pinnedDir
  const golden = (name: string): unknown =>
    JSON.parse(readFileSync(path.join(pinned, name), 'utf8'))
  const names = readdirSync(pinned).filter((name) => /^tree_.*\.json$/.test(name))

  test('are found', () => {
    expect(names.length).toBeGreaterThan(0)
  })

  test.each(names.filter((name) => name.startsWith('tree_prepare_')))(
    '%s is read by parsePrepared',
    (name) => {
      // The GUI does not read the `actions` field yet (PR 3.2), so the parser drops it.
      const { actions: _actions, ...prepared } = golden(name) as Record<string, unknown>
      expect(parsePrepared(golden(name))).toEqual(prepared)
    },
  )

  test.each(names.filter((name) => name.startsWith('tree_children_') && !name.includes('missing')))(
    '%s is read by parsePageResult as a page',
    (name) => {
      expect(parsePageResult(golden(name))).toEqual({ ok: true, page: golden(name) })
    },
  )

  test('the missing-key golden is read as an error', () => {
    expect(parsePageResult(golden('tree_children_missing.json'))).toEqual({
      ok: false,
      message: "Illegal Argument: No child has the key 'nope'.",
    })
  })
})
