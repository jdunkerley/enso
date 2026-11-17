import { attachStyles } from '@/stores/visualization/moduleStyles'

/**
 * Makes the modules the compiler worker sends importable, each with the CSS that came in the same
 * message. `cache` is the table the compiled code reads its imports from; `load` evaluates a
 * module's code (in the browser, `import()` of a blob URL).
 *
 * The styles travel inside the module's notification, so they belong to exactly that module: a
 * file that fails to compile or import leaves nothing behind for the next one of its path, and two
 * overlapping imports of one path cannot take each other's CSS.
 */
export function createModuleImporter(
  cache: Record<string, unknown>,
  load: (code: string) => Promise<unknown>,
): (path: string, code: string, styles: readonly string[]) => Promise<void> {
  /**
   * The code and styles each path was last imported from. This prevents duplicated modules, at the
   * cost of increased memory usage.
   */
  const imported = new Map<string, { code: string; styles: readonly string[] }>()

  return async (path, code, styles) => {
    const previous = imported.get(path)
    // The code alone does not say whether the styles changed: the worker adds a scope id only to
    // components it can recognise, so an edit to a `<style>` can leave the code as it was.
    if (
      previous?.code === code &&
      previous.styles.length === styles.length &&
      previous.styles.every((style, i) => style === styles[i])
    ) {
      return
    }
    imported.set(path, { code, styles })
    // The styles are attached before the module is published, so that nothing mounts the component
    // without them.
    const module = load(code).then((module) => attachStyles(module, styles))
    // Required for the 'compilation-result-response' handler, which awaits the cache entry.
    cache[path] = module
    try {
      const resolved = await module
      // A newer import of the path may have replaced the entry while this one loaded.
      if (cache[path] === module) cache[path] = resolved
    } catch {
      if (cache[path] === module) {
        delete cache[path]
        // So that the same code is tried again.
        imported.delete(path)
      }
      // No error handling - the same Promise is awaited elsewhere.
    }
  }
}
