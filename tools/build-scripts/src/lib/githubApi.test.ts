/** @file The REST client: URLs, headers, bodies and error handling, against a fake `fetch`. */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { gitHub, gitHubFromEnv, uploadTimeoutMs, type FetchLike } from './githubApi.ts'

interface Call {
  readonly url: string
  readonly init: RequestInit | undefined
}

/** A `fetch` that records its calls and answers each with the next of `responses`. */
function fakeFetch(responses: Response[]): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = []
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init })
      const response = responses.shift()
      if (response == null) throw new Error(`unexpected call: ${url}`)
      return response
    },
  }
}

const json = (status: number, value: unknown) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

describe('json', () => {
  test('sends the token and the API version, and parses the answer', async () => {
    const { fetch, calls } = fakeFetch([json(200, { id: 7 })])
    const api = gitHub({ token: 't0k', repository: 'o/r', fetch })
    expect(await api.json('GET', '/repos/o/r/releases/7')).toEqual({ id: 7 })
    expect(calls[0]?.url).toBe('https://api.github.com/repos/o/r/releases/7')
    expect(calls[0]?.init?.headers).toMatchObject({
      Authorization: 'Bearer t0k',
      'X-GitHub-Api-Version': '2022-11-28',
    })
    expect(calls[0]?.init?.body).toBeUndefined()
  })
  test('sends a body as JSON', async () => {
    const { fetch, calls } = fakeFetch([json(201, { id: 1 })])
    await gitHub({ token: 't', repository: 'o/r', fetch }).json('POST', '/x', { draft: true })
    expect(calls[0]?.init?.body).toBe('{"draft":true}')
    expect(calls[0]?.init?.headers).toMatchObject({ 'Content-Type': 'application/json' })
  })
  test('404 is null for GET and DELETE; another failure throws with the message', async () => {
    const { fetch } = fakeFetch([
      json(404, { message: 'Not Found' }),
      json(404, { message: 'Not Found' }),
      json(422, { message: 'Validation Failed' }),
    ])
    const api = gitHub({ token: 't', repository: 'o/r', fetch })
    expect(await api.json('GET', '/a')).toBeNull()
    expect(await api.json('DELETE', '/a')).toBeNull()
    await expect(api.json('POST', '/b', {})).rejects.toThrow(
      /POST https:\/\/api\.github\.com\/b failed: 422 .*Validation Failed/,
    )
  })
  test('404 on PATCH or POST is an error: what was to change has gone', async () => {
    const { fetch } = fakeFetch([json(404, { message: 'Not Found' }), json(404, {})])
    const api = gitHub({ token: 't', repository: 'o/r', fetch })
    await expect(api.json('PATCH', '/releases/9', { draft: false })).rejects.toThrow(
      /PATCH .*releases\/9 failed: 404/,
    )
    await expect(api.json('POST', '/releases', {})).rejects.toThrow(/failed: 404/)
  })
  test('204 is null', async () => {
    const { fetch } = fakeFetch([new Response(null, { status: 204 })])
    expect(await gitHub({ token: 't', repository: 'o/r', fetch }).json('DELETE', '/x')).toBeNull()
  })
})

describe('upload', () => {
  test('posts the file to uploads.github.com, named and typed', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'upload-'))
    const file = path.join(dir, 'latest.yml')
    writeFileSync(file, 'version: 1\n')
    const { fetch, calls } = fakeFetch([json(201, { id: 3 })])
    await gitHub({ token: 't', repository: 'o/r', fetch }).upload(
      42,
      'enso-win-x64-2026.1.1.exe',
      file,
      'text/yaml',
    )
    expect(calls[0]?.url).toBe(
      'https://uploads.github.com/repos/o/r/releases/42/assets?name=enso-win-x64-2026.1.1.exe',
    )
    expect(calls[0]?.init?.method).toBe('POST')
    expect(calls[0]?.init?.headers).toMatchObject({ 'Content-Type': 'text/yaml' })
    expect(Buffer.from(calls[0]?.init?.body as Uint8Array).toString()).toBe('version: 1\n')
    expect(calls[0]?.init?.signal).toBeInstanceOf(AbortSignal)
  })
  test('an upload may take ten minutes plus a second per megabyte', () => {
    expect(uploadTimeoutMs(0)).toBe(600_000)
    expect(uploadTimeoutMs(1)).toBe(601_000)
    expect(uploadTimeoutMs(840_000_000)).toBe(1_440_000)
  })
  test('an empty file is refused before any call', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'upload-'))
    const file = path.join(dir, 'empty.sha256')
    writeFileSync(file, '')
    const { fetch, calls } = fakeFetch([])
    await expect(
      gitHub({ token: 't', repository: 'o/r', fetch }).upload(1, 'empty.sha256', file, 'x/y'),
    ).rejects.toThrow('cannot be empty')
    expect(calls).toEqual([])
  })
})

test('status follows redirects and reports the final status', async () => {
  const { fetch, calls } = fakeFetch([new Response('body', { status: 200 })])
  expect(await gitHub({ token: 't', repository: 'o/r', fetch }).status('https://x/y')).toBe(200)
  expect(calls[0]?.init).toMatchObject({ method: 'GET', redirect: 'follow' })
})

describe('gitHubFromEnv', () => {
  test('needs the token and an owner/name repository', () => {
    expect(() => gitHubFromEnv({ GITHUB_REPOSITORY: 'o/r' })).toThrow('GITHUB_TOKEN is not set.')
    expect(() => gitHubFromEnv({ GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'o' })).toThrow(
      'GITHUB_REPOSITORY is not `owner/name`: "o".',
    )
    expect(gitHubFromEnv({ GITHUB_TOKEN: 't', GITHUB_REPOSITORY: 'o/r' }).repository).toBe('o/r')
  })
})
