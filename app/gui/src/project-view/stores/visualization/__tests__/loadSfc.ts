/** @file Test helper: compile a `.vue` source and evaluate it the way the browser evaluates the worker's output. */
import { readFileSync } from 'node:fs'
import type { Component } from 'vue'
// eslint-disable-next-line no-restricted-imports
import * as vue from 'vue'
import { compileSfc } from '../compileSfc'
import { attachStyles } from '../moduleStyles'

export interface LoadedSfc {
  component: Component & { styles?: string[] }
  styles: string[]
}

/** The modules a compiled file can import, by the name it imports them from (`vue` is always there). */
export type SfcModules = Record<string, Record<string, unknown>>

/**
 * Compile a `.vue` source with the run-time compiler's compile step and evaluate it as the browser
 * evaluates the worker's output: named imports are destructured from `modules` (`vue` is provided),
 * a default import is that module's `default`, and the default export is the component, with its
 * styles attached and its scope id set. The result is also added to `modules` under `fileName`, as
 * `{ default: component, styles }`, so a later file can import it.
 */
export function loadSfc(source: string, fileName: string, modules: SfcModules = {}): LoadedSfc {
  const compiled = compileSfc(source, fileName)
  const moduleExpression = (from: string) =>
    from === 'vue' ? 'vue' : `modules[${JSON.stringify(from)}]`
  const body = compiled.code
    .replace(
      /import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g,
      (_, names: string, from: string) =>
        `const {${names.replace(/\bas\b/g, ':')}} = ${moduleExpression(from)}`,
    )
    .replace(
      /import\s+(\w+)\s+from\s*['"]([^'"]+)['"]/g,
      (_, name: string, from: string) => `const ${name} = ${moduleExpression(from)}.default`,
    )
    .replace(/export const /g, 'const ')
    .replace(/export function /g, 'function ')
    .replace(/export default/, 'return')
  const component = new Function('vue', 'modules', body)(vue, modules) as LoadedSfc['component']
  ;(component as { __scopeId?: string }).__scopeId = `data-v-${compiled.id}`
  const styles = compiled.styles
  attachStyles({ default: component }, styles)
  modules[fileName] = { default: component, styles }
  return { component, styles }
}

/** {@link loadSfc} of a file on disk (a shipped library visualization). */
export function loadShippedSfc(
  filePath: string,
  fileName: string,
  modules: SfcModules = {},
): LoadedSfc {
  return loadSfc(readFileSync(filePath, 'utf8'), fileName, modules)
}
