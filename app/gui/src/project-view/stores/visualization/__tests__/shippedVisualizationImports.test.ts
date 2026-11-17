/**
 * @file Every visualization a standard library ships imports only what the IDE's run-time compiler
 * provides. Vite (and so `shippedVisualizations.test.ts`) resolves any npm import, so a mount test
 * alone would pass a file the IDE cannot load.
 */
import { parse as babelParse } from '@babel/parser'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { BUILTIN_MODULE_NAMES } from '../builtinModules'
import { compileSfc } from '../compileSfc'

const STANDARD = path.resolve(__dirname, '../../../../../../../distribution/lib/Standard')
const shipped = readdirSync(STANDARD).flatMap((lib) => {
  const dir = path.join(STANDARD, lib, '0.0.0-dev', 'visualizations')
  return existsSync(dir) ?
      readdirSync(dir)
        .filter((f) => f.endsWith('.vue'))
        .map((f) => ({ lib, name: f, file: path.join(dir, f) }))
    : []
})

/** Relative imports the compiler follows (`rewriteImports` in `compiler.ts`). */
const FOLLOWED = /\.(vue|ts|svg|png|jpe?g|webp|gif|apng)$/i

/** The imports of compiled visualization code, as the run-time compiler sees them. */
function importsOf(code: string) {
  const sources = babelParse(code, {
    sourceType: 'module',
  }).program.body.flatMap((stmt) => (stmt.type === 'ImportDeclaration' ? [stmt.source.value] : []))
  const isRelative = (s: string) => /^\.\.?\//.test(s)
  return {
    bare: sources.filter((s) => !isRelative(s)),
    relative: sources.filter(isRelative),
    dynamic: /\bimport\s*\(/.test(code),
  }
}

/** What in this compiled code the IDE could not load. */
function unloadable(code: string): string[] {
  const { bare, relative, dynamic } = importsOf(code)
  const allowed: readonly string[] = BUILTIN_MODULE_NAMES
  return [
    ...bare.filter((s) => !allowed.includes(s)).map((s) => `bare import '${s}'`),
    ...relative.filter((s) => !FOLLOWED.test(s)).map((s) => `relative import '${s}'`),
    ...(dynamic ? ['a dynamic import()'] : []),
  ]
}

describe('the import check', () => {
  test('accepts vue and the IDE builtins', () => {
    const { code } = compileSfc(
      `<script setup lang="ts">
import { useVisualizationConfig } from 'builtins'
import { computed } from 'vue'
const c = computed(() => useVisualizationConfig())
</script>
<template><span>{{ c }}</span></template>`,
      'Ok.vue',
    )
    expect(unloadable(code)).toEqual([])
  })

  test('rejects an npm package, a .js file and a dynamic import', () => {
    const { code } = compileSfc(
      `<script setup lang="ts">
import bbox from '@turf/bbox'
import helper from './helper.js'
const lazy = import('sql-formatter')
</script>
<template><span>{{ bbox }}{{ helper }}{{ lazy }}</span></template>`,
      'Bad.vue',
    )
    expect(unloadable(code)).toEqual([
      "bare import '@turf/bbox'",
      "relative import './helper.js'",
      'a dynamic import()',
    ])
  })
})

test.each(shipped)(
  '$lib/$name imports only what the run-time compiler provides',
  ({ file, name }) => {
    const { code } = compileSfc(readFileSync(file, 'utf8'), name)
    expect(unloadable(code)).toEqual([])
  },
)
