/**
 * @file Keeps secrets out of what is sent to Sentry. The user's own Mapbox access token travels in
 * Mapbox's request URLs (`?access_token=`) and must never go anywhere but Mapbox.
 */
import type { Breadcrumb, Event } from '@sentry/vue'

const ACCESS_TOKEN_PARAM = /([?&]access_token=)[^&#\s]*/gi
const SENSITIVE_KEY = /token|secret|password/i

/** The same URL with the value of its `access_token` query parameter replaced by `REDACTED`. */
export function redactAccessToken(url: string): string {
  return url.replace(ACCESS_TOKEN_PARAM, '$1REDACTED')
}

/** A copy of a value with the string values of an object's fields passed through the redactor. */
function redactStrings(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      typeof value === 'string' ? redactAccessToken(value) : value,
    ]),
  )
}

/** Sentry's `beforeBreadcrumb`: redacts the URLs of fetch, xhr and navigation breadcrumbs. */
export function scrubBreadcrumb<T extends Breadcrumb>(breadcrumb: T): T {
  return breadcrumb.data ? { ...breadcrumb, data: redactStrings(breadcrumb.data) } : breadcrumb
}

/** Sentry's `beforeSend`: redacts the request URL and the breadcrumbs of an event. */
export function scrubEvent<T extends Event>(event: T): T {
  const result: T = { ...event }
  if (result.request?.url != null)
    result.request = { ...result.request, url: redactAccessToken(result.request.url) }
  if (result.breadcrumbs) result.breadcrumbs = result.breadcrumbs.map(scrubBreadcrumb)
  if (result.spans)
    result.spans = result.spans.map((span) =>
      span.description != null ?
        { ...span, description: redactAccessToken(span.description) }
      : span,
    )
  return result
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
