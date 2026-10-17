/** @file Secrets (the user's Mapbox token above all) must not reach Sentry. */
import { describe, expect, test } from 'vitest'
import {
  redactAccessToken,
  redactSensitiveFields,
  scrubBreadcrumb,
  scrubDeep,
  scrubEvent,
} from '../redact'

const MAPBOX = 'https://api.mapbox.com/styles/v1/mapbox/streets-v12?access_token=pk.secret&x=1'
const REDACTED = 'https://api.mapbox.com/styles/v1/mapbox/streets-v12?access_token=REDACTED&x=1'

describe('redactAccessToken', () => {
  test('redacts the access_token query parameter, whatever its position', () => {
    expect(redactAccessToken(MAPBOX)).toBe(REDACTED)
    expect(redactAccessToken('https://a.b/c?x=1&access_token=pk.s')).toBe(
      'https://a.b/c?x=1&access_token=REDACTED',
    )
    expect(redactAccessToken('/c?access_token=pk.s#frag')).toBe('/c?access_token=REDACTED#frag')
  })
  test('leaves other strings alone', () => {
    expect(redactAccessToken('https://a.b/c?x=1')).toBe('https://a.b/c?x=1')
  })
})

describe('Sentry hooks', () => {
  test('scrubBreadcrumb redacts fetch, xhr and navigation URLs', () => {
    const fetchCrumb = scrubBreadcrumb({ category: 'fetch', data: { url: MAPBOX, method: 'GET' } })
    expect(fetchCrumb.data?.url).toBe(REDACTED)
    expect(scrubBreadcrumb({ category: 'xhr', data: { url: MAPBOX } }).data?.url).toBe(REDACTED)
    const nav = scrubBreadcrumb({ category: 'navigation', data: { from: MAPBOX, to: MAPBOX } })
    expect(nav.data).toEqual({ from: REDACTED, to: REDACTED })
  })
  test('scrubEvent redacts request.url and breadcrumbs', () => {
    const event = scrubEvent({
      spans: [{ description: 'GET ' + MAPBOX } as never],
      request: { url: MAPBOX },
      breadcrumbs: [{ category: 'fetch', data: { url: MAPBOX } }],
    })
    expect(event.request?.url).toBe(REDACTED)
    expect(event.breadcrumbs?.[0]?.data?.url).toBe(REDACTED)
    expect(event.spans?.[0]?.description).toBe('GET ' + REDACTED)
  })
})

describe('redactSensitiveFields', () => {
  test('redacts fields whose key looks secret, recursively', () => {
    expect(
      redactSensitiveFields({
        accessToken: 'pk.secret',
        apiSecret: 's',
        Password: 'p',
        name: 'n',
        nested: { 'mapbox-token': 't', ok: 1 },
      }),
    ).toEqual({
      accessToken: '[redacted]',
      apiSecret: '[redacted]',
      Password: '[redacted]',
      name: 'n',
      nested: { 'mapbox-token': '[redacted]', ok: 1 },
    })
  })
  test('passes non-objects through', () => {
    expect(redactSensitiveFields('x')).toBe('x')
    expect(redactSensitiveFields(null)).toBe(null)
  })
})

describe('redactAccessToken forms', () => {
  test('matches the name in any case and percent-encoded', () => {
    expect(redactAccessToken('/a?Access_Token=pk.s&b=1')).toBe('/a?Access_Token=REDACTED&b=1')
    expect(redactAccessToken('/a?access%5Ftoken=pk.s')).toBe('/a?access%5Ftoken=REDACTED')
    expect(redactAccessToken('/a?b=1&ACCESS%5ftoken%3Dpk.s')).toBe(
      '/a?b=1&ACCESS%5ftoken%3DREDACTED',
    )
  })
})

describe('scrubDeep', () => {
  test('scrubs strings in nested objects and arrays, without touching the input', () => {
    const input = { a: [MAPBOX, { b: MAPBOX, n: 1 }], c: { d: [[MAPBOX]] } }
    const out = scrubDeep(input)
    expect(out).toEqual({ a: [REDACTED, { b: REDACTED, n: 1 }], c: { d: [[REDACTED]] } })
    expect(input.a[0]).toBe(MAPBOX)
  })
  test('survives cycles and keeps shared references shared', () => {
    const node: Record<string, unknown> = { url: MAPBOX }
    node.self = node
    const out = scrubDeep({ x: node, y: node }) as { x: typeof node; y: typeof node }
    expect(out.x.url).toBe(REDACTED)
    expect(out.x.self).toBe(out.x)
    expect(out.y).toBe(out.x)
  })
  test('copies errors with their message and stack scrubbed', () => {
    const error = new TypeError(`AJAXError: ${MAPBOX}`)
    const out = scrubDeep(error)
    expect(out).toBeInstanceOf(TypeError)
    expect(out.message).toBe(`AJAXError: ${REDACTED}`)
    expect(out.stack).not.toContain('pk.secret')
    expect(error.message).toContain('pk.secret')
  })
})

describe('whole Sentry payloads', () => {
  test('a transaction whose span data holds the token', () => {
    const tx = scrubEvent({
      type: 'transaction',
      contexts: { trace: { data: { url: MAPBOX } } },
      spans: [{ data: { url: MAPBOX, 'http.url': MAPBOX }, description: `GET ${MAPBOX}` }],
    } as never) as never as {
      contexts: { trace: { data: { url: string } } }
      spans: { data: Record<string, string>; description: string }[]
    }
    expect(JSON.stringify(tx)).not.toContain('pk.secret')
    expect(tx.spans[0]?.data['http.url']).toBe(REDACTED)
  })
  test('a console breadcrumb whose arguments hold an Error with the token URL', () => {
    const crumb = scrubBreadcrumb({
      category: 'console',
      message: `Error: ${MAPBOX}`,
      data: { arguments: [new Error(`AJAXError: ${MAPBOX}`)], logger: 'console' },
    })
    const args = crumb.data?.arguments as Error[]
    expect(args[0]?.message).toBe(`AJAXError: ${REDACTED}`)
    expect(crumb.message).toBe(`Error: ${REDACTED}`)
  })
  test('an exception event', () => {
    const event = scrubEvent({
      message: `AJAXError: ${MAPBOX}`,
      exception: { values: [{ type: 'Error', value: `AJAXError: ${MAPBOX}` }] },
    })
    expect(JSON.stringify(event)).not.toContain('pk.secret')
  })
  test('a replay custom event with payload.message', () => {
    const event = scrubDeep({
      type: 5,
      data: { tag: 'breadcrumb', payload: { category: 'console', message: MAPBOX } },
    })
    expect(event.data.payload.message).toBe(REDACTED)
  })
})
