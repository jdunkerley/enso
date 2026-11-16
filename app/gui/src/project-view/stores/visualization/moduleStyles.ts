/**
 * Carries the CSS of run-time compiled `.vue` files to where Vue puts a component's CSS: the
 * `styles` array of the component, which a custom element copies into its shadow root when the
 * component mounts. Visualizations are shown inside `VisualizationHost`'s shadow root, so a
 * `<style>` appended to the document never reaches them.
 */

/**
 * The compiler worker sends a file's style blocks one by one, before the file's module. This holds
 * them until the module arrives, so that a recompiled file starts from nothing: a rule removed from
 * the file is gone from the module too.
 */
export class StyleCollector {
  private readonly pending = new Map<string, string[]>()

  /** Remember one compiled `<style>` block of the file at `path`. */
  add(path: string, css: string) {
    const styles = this.pending.get(path)
    if (styles) styles.push(css)
    else this.pending.set(path, [css])
  }

  /** The style blocks of the file at `path` collected since the last call, in file order. */
  take(path: string): string[] {
    const styles = this.pending.get(path) ?? []
    this.pending.delete(path)
    return styles
  }
}

/**
 * Give the component a module exports its CSS. A module with no styles, or whose default export is
 * not a component, is left as it is. Returns the module.
 */
export function attachStyles<T>(module: T, styles: readonly string[]): T {
  if (styles.length === 0) return module
  const component = (module as { default?: unknown } | null | undefined)?.default
  if (component != null && typeof component === 'object') {
    ;(component as { styles?: string[] }).styles = [...styles]
  }
  return module
}

const keys = new WeakMap<object, number>()
let nextKey = 0

/**
 * A key that is the same for the same component and differs between components. A custom element
 * keeps the CSS of every component it has shown, so the host element is made anew (this is its
 * `key`) when the visualization changes, whether to another one or to a recompiled version of the
 * same: the shadow root then holds the rules of the component on screen and no others.
 */
export function visualizationKey(component: object): number {
  let key = keys.get(component)
  if (key === undefined) {
    key = nextKey++
    keys.set(component, key)
  }
  return key
}
