import { describe, expect, test } from 'vitest'
import { createModuleImporter } from '../moduleImports'

/** A stand-in for `import(blob URL)`: each distinct code gives a module with its own component. */
function setup(options: { failOn?: (code: string) => boolean } = {}) {
  const cache: Record<string, unknown> = {}
  const loads: string[] = []
  const add = createModuleImporter(cache, async (code) => {
    loads.push(code)
    if (options.failOn?.(code)) throw new Error('cannot load')
    return { default: { code } as { code: string; styles?: string[] } }
  })
  return { cache, loads, add }
}
const stylesOf = (cache: Record<string, unknown>, path: string) =>
  ((cache[path] as { default: { styles?: string[] } }).default.styles ?? null) as string[] | null

describe('adding a compiled module', () => {
  test('gives the component the styles of the same notification', async () => {
    const { cache, add } = setup()
    await add('a.vue', 'code', ['.a{}', '.b{}'])
    expect(stylesOf(cache, 'a.vue')).toEqual(['.a{}', '.b{}'])
  })

  test('a failed import does not leave its styles for the next one of the path', async () => {
    const { cache, add } = setup({ failOn: (code) => code === 'broken' })
    await add('a.vue', 'broken', ['.stale{}'])
    expect(cache['a.vue']).toBeUndefined()
    await add('a.vue', 'fixed', ['.fresh{}'])
    expect(stylesOf(cache, 'a.vue')).toEqual(['.fresh{}'])
  })

  test('the same code is tried again after a failed import', async () => {
    let fail = true
    const cache: Record<string, unknown> = {}
    const add = createModuleImporter(cache, async (code) => {
      if (fail) throw new Error('cannot load')
      return { default: { code } }
    })
    await add('a.vue', 'code', [])
    expect(cache['a.vue']).toBeUndefined()
    fail = false
    await add('a.vue', 'code', [])
    expect(cache['a.vue']).toBeDefined()
  })

  test('overlapping imports of one path each keep their own styles; the latest wins', async () => {
    const { cache, add } = setup()
    const first = add('a.vue', 'one', ['.one{}'])
    const second = add('a.vue', 'two', ['.two{}'])
    await Promise.all([first, second])
    expect(stylesOf(cache, 'a.vue')).toEqual(['.two{}'])
    expect((cache['a.vue'] as { default: { code: string } }).default.code).toBe('two')
  })

  test('unchanged code and styles are not imported twice', async () => {
    const { cache, loads, add } = setup()
    await add('a.vue', 'code', ['.a{}'])
    const first = cache['a.vue']
    await add('a.vue', 'code', ['.a{}'])
    expect(loads).toEqual(['code'])
    expect(cache['a.vue']).toBe(first)
  })

  test('a style-only edit with identical code is a new module with the new styles', async () => {
    const { cache, loads, add } = setup()
    await add('a.vue', 'code', ['.a{width:1px}'])
    const first = cache['a.vue']
    await add('a.vue', 'code', ['.a{width:2px}'])
    expect(loads).toHaveLength(2)
    expect(cache['a.vue']).not.toBe(first)
    expect(stylesOf(cache, 'a.vue')).toEqual(['.a{width:2px}'])
  })
})
