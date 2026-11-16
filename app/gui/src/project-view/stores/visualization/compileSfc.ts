/**
 * The pure compile steps of the visualization compiler: Vue single-file components and TypeScript
 * to JavaScript. They do no fetching and no import rewriting, so they run (and are tested)
 * anywhere.
 */

import hash from 'hash-sum'
import { transform } from 'sucrase'
import { compileScript, compileStyle, parse } from 'vue/compiler-sfc'

/**
 * Compile a Vue SFC to JavaScript. `id` is the scope id (a hash of the source) that the scoped
 * `styles` and the component's `__scopeId` share. Throws if the script does not compile.
 */
export function compileSfc(
  source: string,
  filename: string,
): { code: string; styles: string[]; id: string } {
  const parsed = parse(source, { filename })
  const id = hash(source)
  const styles = parsed.descriptor.styles.map(
    (style) =>
      compileStyle({ filename, source: style.content, id, scoped: style.scoped ?? false }).code,
  )
  const scriptTs = compileScript(parsed.descriptor, {
    id,
    inlineTemplate: true,
    sourceMap: false,
  }).content
  return { code: compileTs(scriptTs), styles, id }
}

/** Compile TypeScript to JavaScript, keeping everything else (modules, classes) as written. */
export function compileTs(source: string): string {
  return transform(source, { disableESTransforms: true, transforms: ['typescript'] }).code
}
