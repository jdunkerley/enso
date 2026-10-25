/**
 * @file A small client for GitHub's REST API over `fetch`, for the release commands. It does what
 * the retired build CLI's octocrab calls did and no more: JSON requests against one repository,
 * release-asset uploads (`uploads.github.com`), and checking that a download URL answers. Plain
 * `fetch` rather than Octokit (a new dependency) or `gh`: `gh release upload` finds a release by
 * its tag, and after a re-run two drafts can share one, so the upload must name the draft by id;
 * and the commands need the content type, the retry and the replacement rules in their own hands.
 */
import { readFileSync } from 'node:fs'

/** The part of `fetch` the client uses; tests pass a fake. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

/** A release asset, as the API returns it (the fields the commands read). */
export interface ReleaseAsset {
  readonly id: number
  readonly name: string
  /** `uploaded`, or `starter` for an upload that never finished. */
  readonly state: string
}

/** A release, as the API returns it (the fields the commands read). */
export interface Release {
  readonly id: number
  readonly tag_name: string
  readonly target_commitish: string
  readonly name: string | null
  readonly draft: boolean
  readonly prerelease: boolean
  readonly body: string | null
  readonly html_url: string
  readonly assets: readonly ReleaseAsset[]
}

/** What the release commands need from GitHub. */
export interface GitHub {
  /** `owner/name`. */
  readonly repository: string
  /**
   * A JSON request to `https://api.github.com<route>`: the parsed body, or `null` for a 204. A 404
   * is `null` for `GET` (the thing does not exist) and `DELETE` (absence is the goal); for any
   * other method it is an error, like every other status that is not 2xx.
   */
  json<T>(method: string, route: string, body?: unknown): Promise<T | null>
  /**
   * Uploads `file` as the asset `name` of release `releaseId`. The file is read whole: an installer
   * is under 1 GB, and a buffer gives the request the `Content-Length` the upload API wants.
   */
  upload(releaseId: number, name: string, file: string, contentType: string): Promise<void>
  /** The HTTP status of a GET of `url` (redirects followed); the body is not read. */
  status(url: string): Promise<number>
}

/** Where the client connects, and with what. */
export interface GitHubOptions {
  readonly token: string
  readonly repository: string
  readonly fetch?: FetchLike
  readonly apiUrl?: string
  readonly uploadUrl?: string
}

/** The headers of every API call. */
export function apiHeaders(token: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'User-Agent': 'enso-build-scripts',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

/** An error for a response that is not 2xx, with the API's message. */
async function failure(method: string, url: string, response: Response): Promise<Error> {
  const text = await response.text().catch(() => '')
  return new Error(
    `${method} ${url} failed: ${response.status} ${response.statusText} ${text}`.trim(),
  )
}

/**
 * How long one upload of `bytes` may take: ten minutes, plus a second per megabyte (1 MB/s, a
 * slow home uplink; an 840 MB `.dmg` gets 24 minutes). Without it a stalled upload would hang
 * until the job's timeout. `fetch`'s own timeouts (undici's `headersTimeout` and
 * `bodyTimeout`, 300 s each) cover only the wait for the response, not sending the body.
 */
export function uploadTimeoutMs(bytes: number): number {
  return 600_000 + Math.ceil(bytes / 1_000_000) * 1000
}

/** A client for `options.repository`. */
export function gitHub(options: GitHubOptions): GitHub {
  const doFetch = options.fetch ?? fetch
  const apiUrl = options.apiUrl ?? 'https://api.github.com'
  const uploadUrl = options.uploadUrl ?? 'https://uploads.github.com'
  const headers = apiHeaders(options.token)
  return {
    repository: options.repository,
    async json<T>(method: string, route: string, body?: unknown): Promise<T | null> {
      const url = `${apiUrl}${route}`
      const response = await doFetch(url, {
        method,
        headers: body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      if (response.status === 404 && (method === 'GET' || method === 'DELETE')) return null
      if (!response.ok) throw await failure(method, url, response)
      if (response.status === 204) return null
      return (await response.json()) as T
    },
    async upload(releaseId: number, name: string, file: string, contentType: string) {
      const content = readFileSync(file)
      if (content.length === 0) throw new Error(`Release asset file cannot be empty: ${file}`)
      const url =
        `${uploadUrl}/repos/${options.repository}/releases/${releaseId}/assets` +
        `?name=${encodeURIComponent(name)}`
      const response = await doFetch(url, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': contentType },
        body: content,
        signal: AbortSignal.timeout(uploadTimeoutMs(content.length)),
      })
      if (!response.ok) throw await failure('POST', url, response)
    },
    async status(url: string): Promise<number> {
      const response = await doFetch(url, { method: 'GET', redirect: 'follow' })
      await response.body?.cancel()
      return response.status
    },
  }
}

/** The client for this workflow run: `GITHUB_TOKEN` and `GITHUB_REPOSITORY`, both required. */
export function gitHubFromEnv(env: Readonly<Record<string, string | undefined>>): GitHub {
  const token = env.GITHUB_TOKEN ?? ''
  const repository = env.GITHUB_REPOSITORY ?? ''
  if (token === '') throw new Error('GITHUB_TOKEN is not set.')
  if (!/^[^/\s]+\/[^/\s]+$/.test(repository)) {
    throw new Error(`GITHUB_REPOSITORY is not \`owner/name\`: ${JSON.stringify(repository)}.`)
  }
  return gitHub({ token, repository })
}
