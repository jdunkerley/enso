/** @file Secrets (the user's Mapbox token above all) must not reach Sentry. */
import { describe, expect, test } from 'vitest'
import { redactAccessToken, redactSensitiveFields, scrubBreadcrumb, scrubEvent } from '../redact'

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
