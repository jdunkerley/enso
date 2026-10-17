/**
 * @file Keeps secrets out of what is sent to Sentry. The user's own Mapbox access token travels in
 * Mapbox's request URLs (`?access_token=`) and must never go anywhere but Mapbox.
 */
import type { Breadcrumb, Event } from '@sentry/vue'

const ACCESS_TOKEN_PARAM = /(access(?:_|%5F)token(?:=|%3D))[^&#\s'"]*/gi
const SENSITIVE_KEY = /token|secret|password/i

/**
 * The same text with the value of every `access_token` query parameter (any case, plain or
 * percent-encoded) replaced by `REDACTED`.
 */
export function redactAccessToken(url: string): string {
  return url.replace(ACCESS_TOKEN_PARAM, '$1REDACTED')
}

function isLeaf(value: object): boolean {
  return (
    value instanceof Date ||
    value instanceof RegExp ||
    value instanceof Map ||
    value instanceof Set ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value)
  )
}

/**
 * A deep copy of any value with {@link redactAccessToken} applied to every string in it: object
 * fields, array items, and the message and stack of errors (which are copied, as their text is not
 * an own enumerable property). Cycles and shared references are preserved.
 */
export function scrubDeep<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  if (typeof value === 'string') return redactAccessToken(value) as T
  if (value == null || typeof value !== 'object' || isLeaf(value)) return value
  const original = value as object
  if (seen.has(original)) return seen.get(original) as T
  if (original instanceof Error) {
    const copy = Object.create(Object.getPrototypeOf(original)) as Record<string, unknown>
    seen.set(original, copy)
    for (const key of Object.getOwnPropertyNames(original))
      copy[key] = scrubDeep((original as unknown as Record<string, unknown>)[key], seen)
    return copy as T
  }
  if (Array.isArray(original)) {
    const copy: unknown[] = []
    seen.set(original, copy)
    for (const item of original) copy.push(scrubDeep(item, seen))
    return copy as T
  }
  const copy = Object.create(Object.getPrototypeOf(original)) as Record<string, unknown>
  seen.set(original, copy)
  for (const [key, field] of Object.entries(original)) copy[key] = scrubDeep(field, seen)
  return copy as T
}

/** Sentry's `beforeBreadcrumb`: scrubs the whole breadcrumb. */
export function scrubBreadcrumb<T extends Breadcrumb>(breadcrumb: T): T {
  return scrubDeep(breadcrumb)
}

/** Sentry's `beforeSend` and `beforeSendTransaction`: scrubs the whole event. */
export function scrubEvent<T extends Event>(event: T): T {
  return scrubDeep(event)
}

/** A copy of `value` with every field whose key looks secret (token, secret, password) redacted. */
export function redactSensitiveFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitiveFields)
  if (value == null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([key, field]) => [
      key,
      SENSITIVE_KEY.test(key) ? '[redacted]' : redactSensitiveFields(field),
    ]),
  )
}
