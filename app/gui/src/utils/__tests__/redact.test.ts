/** @file Secrets (the user's Mapbox token above all) must not reach Sentry. */
import { mapboxSettingsStore } from '$/providers/mapboxToken'
import * as sentry from '@sentry/vue'
import { afterEach, describe, expect, test } from 'vitest'
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

describe('scrubDeep safety', () => {
  test('keeps class instances as they are, without copying them', () => {
    class Holder {
      url = MAPBOX
    }
    const holder = new Holder()
    const out = scrubDeep({ holder, when: new Date(0) })
    expect(out.holder).toBe(holder)
    expect(out.when).toBeInstanceOf(Date)
  })
  test('copies objects without a prototype', () => {
    const bare = Object.assign(Object.create(null) as Record<string, string>, { url: MAPBOX })
    expect(scrubDeep(bare).url).toBe(REDACTED)
  })
  test('does not throw on a 10,000-node linked list, and stops at the depth cap', () => {
    type Node = { url: string; next: Node | null }
    let list: Node | null = null
    for (let i = 0; i < 10_000; i++) list = { url: MAPBOX, next: list }
    const out = scrubDeep(list)
    expect(out?.url).toBe(REDACTED)
    expect(JSON.stringify(out)).not.toContain('pk.secret')
  })
  test('passes sdkProcessingMetadata through untouched', () => {
    const metadata = { capturedSpanScope: { url: MAPBOX } }
    const out = scrubEvent({ message: MAPBOX, sdkProcessingMetadata: metadata })
    expect(out.sdkProcessingMetadata).toBe(metadata)
    expect(out.message).toBe(REDACTED)
  })
  test('never throws, even on a getter that does', () => {
    const hostile = {
      url: MAPBOX,
      get boom(): string {
        throw new Error('no')
      },
    }
    const out = scrubDeep(hostile)
    expect(out.url).toBe(REDACTED)
  })
})

describe('the stored token', () => {
  afterEach(() => mapboxSettingsStore.setState({ accessToken: null }))

  test('is replaced wherever it appears, in any shape', () => {
    mapboxSettingsStore.setState({ accessToken: 'pk.longSecretValue' })
    const out = scrubEvent({
      message: 'props {"accessToken":"pk.longSecretValue"}',
      extra: { bare: 'token pk.longSecretValue here', encoded: encodeURIComponent('x') },
    })
    expect(out.message).toBe('props {"accessToken":"REDACTED"}')
    expect(out.extra?.bare).toBe('token REDACTED here')
  })
  test('is not searched for when shorter than 8 characters, or empty', () => {
    mapboxSettingsStore.setState({ accessToken: 'pk.a' })
    expect(scrubDeep('pk.abc and pk.a')).toBe('pk.abc and pk.a')
    mapboxSettingsStore.setState({ accessToken: null })
    expect(scrubDeep('plain text')).toBe('plain text')
  })
})

describe('a real Sentry transaction', () => {
  test('its live spans are sent scrubbed, and the client graph is not walked', async () => {
    const sent: string[] = []
    // A stand-in for the Vue app that `@sentry/vue` copies into the client's options.
    type Node = { url: string; next: Node | null }
    let app: Node | null = null
    for (let i = 0; i < 20_000; i++) app = { url: MAPBOX, next: app }
    const client = new sentry.BrowserClient({
      dsn: 'https://key@o0.ingest.sentry.io/0',
      integrations: [],
      stackParser: sentry.defaultStackParser,
      transport: () => ({
        send: (envelope) => {
          sent.push(JSON.stringify(envelope))
          return Promise.resolve({})
        },
        flush: () => Promise.resolve(true),
      }),
      tracesSampleRate: 1,
      beforeSendTransaction: scrubEvent,
      ...({ app } as object),
    })
    sentry.setCurrentClient(client)
    client.init()
    sentry.addTracingExtensions()
    sentry.startSpan({ name: 'pageload' }, () => {
      sentry
        .startInactiveSpan({
          name: `GET ${MAPBOX}`,
          op: 'resource.fetch',
          attributes: { url: MAPBOX },
        })
        ?.end()
    })
    await client.flush(2000)
    const envelope = sent.find((text) => text.includes('"type":"transaction"'))
    expect(envelope).toBeDefined()
    expect(envelope).toContain('access_token=REDACTED')
    expect(envelope).not.toContain('pk.secret')
  })
})
