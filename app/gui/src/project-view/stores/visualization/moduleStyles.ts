/**
 * Carries the CSS of run-time compiled `.vue` files to where Vue puts a component's CSS: the
 * `styles` array of the component, which a custom element copies into its shadow root when the
 * component mounts. Visualizations are shown inside `VisualizationHost`'s shadow root, so a
 * `<style>` appended to the document never reaches them.
 */

/**
 * Give the component a module exports its CSS (the `styles` of the module's notification). A
 * module with no styles, or whose default export is not a component, is left as it is. Returns the
 * module.
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

/**
 * The `key` of the host element after the view on screen became `view` with `status`. Only a real
 * visualization (`ready`) sets it; the loading and error views, which come and go with every
 * preprocessor change, keep the key of the last real one, so the element is made anew only on a
 * switch between visualizations or a recompile.
 */
export function hostKeyFor(
  status: 'ready' | 'loading' | 'error',
  view: unknown,
  previous: number | undefined,
): number | undefined {
  return (
      status === 'ready' &&
        ((typeof view === 'object' && view !== null) || typeof view === 'function')
    ) ?
      visualizationKey(view)
    : previous
}
