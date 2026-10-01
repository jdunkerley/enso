/**
 * @file Framework-free helpers for a form's value object: read, immutably write and compare values
 * by dotted path (`address.city`, `tags.0`).
 *
 * Values are replaced, never mutated, so that class instances among them (`@internationalized/date`
 * values, `File`s) are never wrapped in a reactive proxy: some use private fields, which a proxy
 * breaks.
 */

/** Whether a value is a plain object (not an array, class instance or null). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value == null) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/** Split a dotted path into its keys. */
function keysOf(path: string): string[] {
  return path === '' ? [] : path.split('.')
}

/** The value at a dotted path, or `undefined` if any step is missing. */
export function getPath(values: unknown, path: string): unknown {
  let current = values
  for (const key of keysOf(path)) {
    if (current == null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

/** A copy of `values` with the value at `path` replaced. Only the objects along the path are copied. */
export function setPath<T>(values: T, path: string, value: unknown): T {
  const keys = keysOf(path)
  if (keys.length === 0) return value as T
  const [head, ...rest] = keys as [string, ...string[]]
  const container: unknown = values
  const child = setPath(
    container != null && typeof container === 'object' ?
      (container as Record<string, unknown>)[head]
    : undefined,
    rest.join('.'),
    value,
  )
  if (Array.isArray(container)) {
    const copy = [...container]
    copy[Number(head)] = child
    return copy as T
  }
  const isIndex = /^\d+$/.test(head)
  if (container == null || typeof container !== 'object') {
    if (isIndex) {
      const copy: unknown[] = []
      copy[Number(head)] = child
      return copy as T
    }
    return { [head]: child } as T
  }
  return { ...(container as Record<string, unknown>), [head]: child } as T
}

/** A deep copy of plain objects and arrays; everything else (dates, files, class instances) is shared. */
export function cloneValues<T>(value: T): T {
  if (Array.isArray(value)) return value.map(cloneValues) as T
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, cloneValues(v)])) as T
  }
  return value
}

/**
 * Structural equality for form values: plain objects and arrays by content, other objects of the
 * same class by their string form (so two equal `CalendarDate`s are equal), the rest by
 * `Object.is`.
 */
export function valuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a == null || b == null) return false
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, i) => valuesEqual(item, b[i]))
  }
  if (isPlainObject(a) || isPlainObject(b)) {
    if (!isPlainObject(a) || !isPlainObject(b)) return false
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const key of keys) {
      if (!valuesEqual(a[key], b[key])) return false
    }
    return true
  }
  if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  if (typeof Blob !== 'undefined' && (a instanceof Blob || b instanceof Blob)) return false
  return String(a) === String(b)
}

/** The dotted paths of every leaf in `values` (a leaf is anything but a plain object or array). */
export function leafPaths(values: unknown, prefix = ''): string[] {
  if (Array.isArray(values)) {
    // An array is a field value in its own right (a multi-selector's, a checkbox group's).
    return prefix === '' ? values.flatMap((v, i) => leafPaths(v, String(i))) : [prefix]
  }
  if (isPlainObject(values)) {
    return Object.entries(values).flatMap(([key, v]) =>
      leafPaths(v, prefix === '' ? key : `${prefix}.${key}`),
    )
  }
  return prefix === '' ? [] : [prefix]
}

/** Whether `path` is `parent` or inside it. */
export function isPathWithin(path: string, parent: string): boolean {
  return path === parent || path.startsWith(parent + '.')
}
