/**
 * @file Keeps secrets out of what is sent to Sentry. The user's own Mapbox access token travels in
 * Mapbox's request URLs (`?access_token=`) and must never go anywhere but Mapbox.
 */
import { mapboxSettingsStore } from '$/providers/mapboxToken'
import type { Breadcrumb, Event, replayIntegration } from '@sentry/vue'

const ACCESS_TOKEN_PARAM = /(access(?:_|%5F)token(?:=|%3D))[^&#\s'"]*/gi
const SENSITIVE_KEY = /token|secret|password/i
const REDACTED = 'REDACTED'
/** A stored token shorter than this is not searched for: it could match ordinary text. */
const MIN_LITERAL_TOKEN_LENGTH = 8
/** How deep {@link scrubDeep} copies. Sentry itself normalizes most of an event to depth 3. */
const MAX_DEPTH = 20
/** What replaces a value nested deeper than {@link MAX_DEPTH}. */
const TOO_DEEP = '[too deep to scrub]'
/** Sentry's own bookkeeping on an event (live scopes); deleted before sending (`envelope.js`). */
const SDK_PROCESSING_METADATA = 'sdkProcessingMetadata'

/**
 * Elements Sentry Replay must not record at all: neither their attributes nor their children. The
 * map visualization is one, as Mapbox GL writes the access token into a link's `href` inside it.
 * Each such element also carries `data-sentry-block`, Replay's own marker, as a second safeguard.
 */
export const REPLAY_BLOCK_SELECTORS: readonly string[] = ['.GeoMapVisualization']

/**
 * The same text with the value of every `access_token` query parameter (any case, plain or
 * percent-encoded) replaced by `REDACTED`.
 */
export function redactAccessToken(url: string): string {
  return url.replace(ACCESS_TOKEN_PARAM, `$1${REDACTED}`)
}

/** The user's stored Mapbox token, when it is long enough to search for. Read at call time. */
function literalToken(): string | null {
  const token = mapboxSettingsStore.getState().accessToken
  return token != null && token.length >= MIN_LITERAL_TOKEN_LENGTH ? token : null
}

/**
 * {@link redactAccessToken}, then every occurrence of the stored token itself (plain or
 * percent-encoded) replaced, whatever surrounds it.
 */
function redactString(text: string, token: string | null): string {
  let result = redactAccessToken(text)
  if (token != null) {
    result = result.split(token).join(REDACTED)
    const encoded = encodeURIComponent(token)
    if (encoded !== token) result = result.split(encoded).join(REDACTED)
  }
  return result
}

/** Whether `value` is an object literal (or `Object.create(null)`), not an instance of a class. */
function isPlainObject(value: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function walk(
  value: unknown,
  seen: WeakMap<object, unknown>,
  depth: number,
  token: string | null,
): unknown {
  if (typeof value === 'string') return redactString(value, token)
  if (value == null || typeof value !== 'object') return value
  if (seen.has(value)) return seen.get(value)
  const isError = value instanceof Error
  // Other class instances (Sentry's scopes and spans, the Vue app, DOM nodes...) are kept as they
  // are: copying them would walk the whole app, and Sentry serializes them shallowly if at all.
  if (!isError && !Array.isArray(value) && !isPlainObject(value)) return value
  if (depth >= MAX_DEPTH) return TOO_DEEP
  if (Array.isArray(value)) {
    const copy: unknown[] = []
    seen.set(value, copy)
    for (const item of value) copy.push(walk(item, seen, depth + 1, token))
    return copy
  }
  const copy = Object.create(Object.getPrototypeOf(value)) as Record<string, unknown>
  seen.set(value, copy)
  // An error's message and stack are not enumerable, so its own property names are used.
  const keys = isError ? Object.getOwnPropertyNames(value) : Object.keys(value)
  for (const key of keys) {
    const field = (value as Record<string, unknown>)[key]
    copy[key] = key === SDK_PROCESSING_METADATA ? field : walk(field, seen, depth + 1, token)
  }
  return copy
}

/**
 * Every string in `value` redacted by a JSON round trip. Failing that, a copy of its top level with
 * its strings redacted, leaving out any field that cannot be read.
 */
function fallbackScrub(value: unknown, token: string | null): unknown {
  try {
    return JSON.parse(redactString(JSON.stringify(value), token))
  } catch {
    // Fall back to the top level.
  }
  const scrubField = (field: unknown) =>
    typeof field === 'string' ? redactString(field, token) : field
  try {
    if (typeof value === 'string') return redactString(value, token)
    if (value == null || typeof value !== 'object') return value
    if (Array.isArray(value)) return value.map(scrubField)
    const copy: Record<string, unknown> = {}
    for (const key of Object.keys(value)) {
      try {
        copy[key] = scrubField((value as Record<string, unknown>)[key])
      } catch {
        // A field that cannot be read is left out.
      }
    }
    return copy
  } catch {
    // Not even the top level can be read (a hostile proxy): nothing can be done with it.
    return value
  }
}

/**
 * A copy of `value` with {@link redactAccessToken}, and the removal of the stored Mapbox token,
 * applied to every string in it: the fields of plain objects, array items, and the own properties
 * of errors (whose message and stack are not enumerable). Instances of any other class are kept as
 * they are, and `sdkProcessingMetadata` is passed through untouched. Cycles and shared references
 * are preserved; anything nested deeper than {@link MAX_DEPTH} is replaced. Never throws.
 */
export function scrubDeep<T>(value: T): T {
  let token: string | null = null
  try {
    token = literalToken()
    return walk(value, new WeakMap(), 0, token) as T
  } catch {
    return fallbackScrub(value, token) as T
  }
}

/** A span's JSON, as Sentry serializes it; the value itself when it is not a live span. */
function spanJson(span: unknown): unknown {
  if (span == null || typeof span !== 'object') return span
  const live = span as { getSpanJSON?: () => unknown; toJSON?: () => unknown }
  if (typeof live.getSpanJSON === 'function') return live.getSpanJSON()
  if (typeof live.toJSON === 'function') return live.toJSON()
  return span
}

/** Sentry's `beforeBreadcrumb`: scrubs the whole breadcrumb. */
export function scrubBreadcrumb<T extends Breadcrumb>(breadcrumb: T): T {
  return scrubDeep(breadcrumb)
}

/**
 * Sentry's `beforeSend` and `beforeSendTransaction`: scrubs the whole event. A v7 transaction's
 * `spans` are still live `Span` objects here; each is replaced by its JSON (what Sentry would send
 * for it), scrubbed. If a span cannot be read, the spans are dropped rather than sent unscrubbed.
 */
export function scrubEvent<T extends Event>(event: T): T {
  const scrubbed = scrubDeep(event)
  if (!Array.isArray(event.spans)) return scrubbed
  let spans: unknown[]
  try {
    spans = event.spans.map((span) => scrubDeep(spanJson(span)))
  } catch {
    spans = []
  }
  return { ...scrubbed, spans } as T
}

/** Sentry Replay's options that keep the token out of recordings. */
export const replayPrivacyOptions = {
  block: [...REPLAY_BLOCK_SELECTORS],
  beforeAddRecordingEvent: (event) => scrubDeep(event),
} satisfies Parameters<typeof replayIntegration>[0]

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
