/** @file The release operations, against an in-memory GitHub. */
/* eslint-disable camelcase -- GitHub's REST API names its fields in snake_case. */
import { describe, expect, test } from 'vitest'
import type { GitHub, Release, ReleaseAsset } from '../lib/githubApi.ts'
import { version } from '../version/version.ts'
import {
  createDraft,
  isPrerelease,
  parseDesignation,
  publishRelease,
  releaseId,
  releaseVersion,
  uploadIdeAssets,
} from './release.ts'

interface Call {
  readonly method: string
  readonly route: string
  readonly body?: unknown
}

/**
 * A GitHub that answers from `routes` (`"<METHOD> <route>"` → answer, or a function of the body)
 * and records every call. An unknown route answers `null` (404).
 */
function fakeGitHub(
  routes: Record<string, unknown>,
  options: {
    uploadFailures?: number
    statuses?: Record<string, number>
  } = {},
): { api: GitHub; calls: Call[]; uploads: string[] } {
  const calls: Call[] = []
  const uploads: string[] = []
  let failures = options.uploadFailures ?? 0
  const api: GitHub = {
    repository: 'o/r',
    async json<T>(method: string, route: string, body?: unknown): Promise<T | null> {
      calls.push({ method, route, ...(body === undefined ? {} : { body }) })
      const answer = routes[`${method} ${route}`]
      const value =
        typeof answer === 'function' ? (answer as (b: unknown) => unknown)(body) : answer
      return (value ?? null) as T | null
    },
    async upload(id: number, name: string, _file: string, type: string) {
      if (failures > 0) {
        failures--
        throw new Error('connection reset')
      }
      uploads.push(`${id} ${name} ${type}`)
    },
    async status(url: string) {
      return options.statuses?.[url] ?? 200
    },
  }
  return { api, calls, uploads }
}

const release = (overrides: Partial<Release> = {}): Release => ({
  id: 9,
  tag_name: '2026.1.1-rc.5',
  target_commitish: 'abc',
  name: 'Enso 2026.1.1-rc.5',
  draft: true,
  prerelease: true,
  body: 'notes',
  html_url: 'https://github.com/o/r/releases/tag/untagged-1',
  assets: [],
  ...overrides,
})

describe('releaseVersion', () => {
  test('ENSO_VERSION, which must be a version', () => {
    expect(releaseVersion({ ENSO_VERSION: '2026.1.1-rc.5' }).text).toBe('2026.1.1-rc.5')
    expect(() => releaseVersion({})).toThrow('ENSO_VERSION is not a version: "".')
    expect(() => releaseVersion({ ENSO_VERSION: 'v2026.1.1' })).toThrow('"v2026.1.1"')
  })
  test('a set ENSO_EDITION must equal it', () => {
    expect(() => releaseVersion({ ENSO_VERSION: '2026.1.1', ENSO_EDITION: '2026.1.2' })).toThrow(
      'Inconsistent ENSO_VERSION and ENSO_EDITION variable values.',
    )
  })
})

test('releaseId', () => {
  expect(releaseId({ ENSO_RELEASE_ID: '258412335' })).toBe(258412335)
  expect(() => releaseId({ ENSO_RELEASE_ID: '' })).toThrow('ENSO_RELEASE_ID is not a release id')
})

test('parseDesignation', () => {
  expect(parseDesignation('rc')).toBe('rc')
  expect(() => parseDesignation('beta')).toThrow(
    'Unknown designation "beta"; expected one of stable, patch, rc, nightly.',
  )
})

test('rc and nightly are prereleases, stable is not', () => {
  expect(isPrerelease(version('2026.1.1-rc.5'))).toBe(true)
  expect(isPrerelease(version('2026.1.1-nightly.2026.10.23'))).toBe(true)
  expect(isPrerelease(version('2026.1.1'))).toBe(false)
})

describe('createDraft', () => {
  const inputs = (head: string | null = 'abc') => ({
    version: version('2026.1.1-rc.5'),
    commit: 'abc',
    head,
    changelog: '# Next Release\n\n- a change\n',
    log: () => {},
  })
  test('creates a prerelease draft at the commit, named and with the notes', async () => {
    const { api, calls } = fakeGitHub({ 'POST /repos/o/r/releases': release() })
    expect((await createDraft(api, inputs())).id).toBe(9)
    expect(calls.map((call) => `${call.method} ${call.route}`)).toEqual([
      'GET /repos/o/r/releases/tags/2026.1.1-rc.5',
      'GET /repos/o/r/git/ref/tags/2026.1.1-rc.5',
      'POST /repos/o/r/releases',
    ])
    expect(calls[2]?.body).toMatchObject({
      tag_name: '2026.1.1-rc.5',
      target_commitish: 'abc',
      name: 'Enso 2026.1.1-rc.5',
      prerelease: true,
      draft: true,
    })
    expect((calls[2]?.body as { body: string }).body).toContain('# Changelog\n\n- a change\n')
  })
  test('a stable version is not a prerelease', async () => {
    const { api, calls } = fakeGitHub({ 'POST /repos/o/r/releases': release() })
    await createDraft(api, { ...inputs(), version: version('2026.2.1') })
    expect(calls[2]?.body).toMatchObject({ prerelease: false })
  })
  test('refuses another HEAD, a published release and an existing tag', async () => {
    await expect(createDraft(fakeGitHub({}).api, inputs('def'))).rejects.toThrow(
      'Local HEAD def is not the same as the commit abc we were ordered to build.',
    )
    const published = fakeGitHub({
      'GET /repos/o/r/releases/tags/2026.1.1-rc.5': release({ draft: false }),
    })
    await expect(createDraft(published.api, inputs())).rejects.toThrow(
      'Release 2026.1.1-rc.5 has already been published.',
    )
    const tagged = fakeGitHub({
      'GET /repos/o/r/git/ref/tags/2026.1.1-rc.5': { object: { sha: 'f00', type: 'commit' } },
    })
    await expect(createDraft(tagged.api, inputs())).rejects.toThrow(
      'Tag 2026.1.1-rc.5 already exists on remote as {"sha":"f00","type":"commit"}.',
    )
  })
  test('outside a checkout there is no HEAD to compare', async () => {
    const { api } = fakeGitHub({ 'POST /repos/o/r/releases': release() })
    expect((await createDraft(api, inputs(null))).id).toBe(9)
  })
})

describe('publishRelease', () => {
  const all = [
    { id: 1, name: 'enso-win-x64-2026.1.1-rc.5.exe', state: 'uploaded' },
    { id: 2, name: 'enso-linux-x86_64-2026.1.1-rc.5.AppImage', state: 'uploaded' },
    { id: 3, name: 'enso-mac-arm64-2026.1.1-rc.5.dmg', state: 'uploaded' },
  ]
  test('publishes with the tag restated, and checks every installer downloads', async () => {
    const published = release({ draft: false, assets: all })
    let first = true
    const { api, calls } = fakeGitHub({
      'GET /repos/o/r/releases/9': () => {
        const answer = first ? release({ assets: all }) : published
        first = false
        return answer
      },
    })
    expect(await publishRelease(api, 9, version('2026.1.1-rc.5'), () => {})).toEqual([])
    expect(calls[1]).toEqual({
      method: 'PATCH',
      route: '/repos/o/r/releases/9',
      body: { tag_name: '2026.1.1-rc.5', target_commitish: 'abc', body: 'notes', draft: false },
    })
  })
  test('without the dmg: a note, and macOS is not checked', async () => {
    const two = all.slice(0, 2)
    let first = true
    const { api, calls } = fakeGitHub({
      'GET /repos/o/r/releases/9': () => {
        const answer = first ? release({ assets: two }) : release({ draft: false, assets: two })
        first = false
        return answer
      },
    })
    const logged: string[] = []
    const missing = await publishRelease(api, 9, version('2026.1.1-rc.5'), (l) => logged.push(l))
    expect(missing.map((target) => target.os)).toEqual(['macos'])
    expect((calls[1]?.body as { body: string }).body).toBe(
      'notes\n\n> [!NOTE]\n> This release was published without an installer for macOS (Apple ' +
        'silicon): that build failed or was skipped. Re-running its jobs in the release workflow ' +
        'uploads it here.',
    )
    expect(logged[0]).toBe('::warning::Publishing without installers for: macOS (Apple silicon).')
  })
  test('refuses a published release and a missing one', async () => {
    const done = fakeGitHub({ 'GET /repos/o/r/releases/9': release({ draft: false }) })
    await expect(publishRelease(done.api, 9, version('2026.1.1'), () => {})).rejects.toThrow(
      'Release has been already published!',
    )
    await expect(
      publishRelease(fakeGitHub({}).api, 9, version('2026.1.1'), () => {}),
    ).rejects.toThrow('Release 9 does not exist.')
  })
  test('refuses a draft of another version, and one with a half-written asset', async () => {
    const other = fakeGitHub({ 'GET /repos/o/r/releases/9': release() })
    await expect(publishRelease(other.api, 9, version('2026.1.1-rc.6'), () => {})).rejects.toThrow(
      'Release 9 is 2026.1.1-rc.5, not 2026.1.1-rc.6: check the release id and version.',
    )
    const partial = fakeGitHub({
      'GET /repos/o/r/releases/9': release({
        assets: [...all.slice(0, 2), { id: 3, name: all[2]?.name ?? '', state: 'starter' }],
      }),
    })
    await expect(
      publishRelease(partial.api, 9, version('2026.1.1-rc.5'), () => {}),
    ).rejects.toThrow(
      'Not publishing: assets not fully uploaded: enso-mac-arm64-2026.1.1-rc.5.dmg (starter).',
    )
    expect(partial.calls.some((call) => call.method === 'PATCH')).toBe(false)
  })
  test('an installer that does not download fails the validation', async () => {
    let first = true
    const url =
      'https://github.com/o/r/releases/download/2026.1.1-rc.5/enso-win-x64-2026.1.1-rc.5.exe'
    const { api } = fakeGitHub(
      {
        'GET /repos/o/r/releases/9': () => {
          const answer = first ? release({ assets: all }) : release({ draft: false, assets: all })
          first = false
          return answer
        },
      },
      { statuses: { [url]: 404 } },
    )
    await expect(publishRelease(api, 9, version('2026.1.1-rc.5'), () => {})).rejects.toThrow(
      `Failed to download asset: ${url} (404).`,
    )
  })
})

describe('uploadIdeAssets', () => {
  const exe = 'enso-win-x64-2026.1.1-rc.5.exe'
  const files = [
    { file: `/d/${exe}`, name: exe },
    { file: '/d/latest.yml', name: 'latest.yml' },
  ]

  /**
   * A GitHub holding one release whose assets change as the client acts: a successful upload
   * adds an `uploaded` asset, a failed one (the first `failures`) a `starter` one, a DELETE removes.
   * The GETs of the release numbered in `failingGets` (from 0) fail, as a transient API error.
   */
  function statefulGitHub(
    draft: boolean,
    assets: ReleaseAsset[],
    failures = 0,
    failingGets: readonly number[] = [],
  ): { api: GitHub; log: string[]; current: () => ReleaseAsset[] } {
    const log: string[] = []
    let left = failures
    let nextId = 100
    let gets = 0
    let held = [...assets]
    const api: GitHub = {
      repository: 'o/r',
      async json<T>(method: string, route: string): Promise<T | null> {
        log.push(`${method} ${route}`)
        if (method === 'GET' && route === '/repos/o/r/releases/9') {
          if (failingGets.includes(gets++)) throw new Error('bad gateway')
          return release({ draft, assets: held }) as T
        }
        const deleted = /^\/repos\/o\/r\/releases\/assets\/(\d+)$/.exec(route)
        if (method === 'DELETE' && deleted != null) {
          held = held.filter((asset) => asset.id !== Number(deleted[1]))
          return null
        }
        throw new Error(`unexpected ${method} ${route}`)
      },
      async upload(_id: number, name: string) {
        log.push(`upload ${name}`)
        if (left > 0) {
          left--
          held = [...held, { id: nextId++, name, state: 'starter' }]
          throw new Error('connection reset')
        }
        held = [...held, { id: nextId++, name, state: 'uploaded' }]
      },
      async status() {
        return 200
      },
    }
    return { api, log, current: () => held }
  }
  const noWait = async () => {}

  test('uploads each file to the draft, typed by its name', async () => {
    const { api, uploads } = fakeGitHub({ 'GET /repos/o/r/releases/9': release() })
    await uploadIdeAssets(api, 9, files, () => {})
    expect(uploads).toEqual([
      `9 ${exe} application/vnd.microsoft.portable-executable`,
      '9 latest.yml text/yaml',
    ])
  })
  test('on a draft, a failed upload deletes its half-written asset and retries', async () => {
    const { api, log, current } = statefulGitHub(true, [], 1)
    const waits: number[] = []
    await uploadIdeAssets(
      api,
      9,
      files,
      () => {},
      async (ms) => {
        waits.push(ms)
      },
    )
    expect(waits).toEqual([500])
    expect(log.filter((line) => line.startsWith('DELETE'))).toEqual([
      'DELETE /repos/o/r/releases/assets/100',
    ])
    expect(current().map((asset) => `${asset.name} ${asset.state}`)).toEqual([
      `${exe} uploaded`,
      'latest.yml uploaded',
    ])
  })
  test('on a draft, an asset an earlier run uploaded is replaced', async () => {
    const { api, current } = statefulGitHub(true, [{ id: 7, name: exe, state: 'uploaded' }])
    const logged: string[] = []
    await uploadIdeAssets(api, 9, files, (line) => logged.push(line), noWait)
    expect(logged[0]).toBe(`Replacing ${exe}, left on the draft by an earlier run.`)
    expect(current().map((asset) => asset.id)).toEqual([100, 101])
  })
  test('on a draft, the last failed attempt is cleaned up too, then the error stands', async () => {
    const { api, current } = statefulGitHub(true, [], 6)
    await expect(uploadIdeAssets(api, 9, files, () => {}, noWait)).rejects.toThrow(
      'connection reset',
    )
    expect(current()).toEqual([])
  })
  test('on a published release, a missing installer is added', async () => {
    const { api, current } = statefulGitHub(false, [
      { id: 1, name: 'latest.yml', state: 'uploaded' },
    ])
    await uploadIdeAssets(api, 9, [files[0] ?? { file: '', name: '' }], () => {}, noWait)
    expect(current().map((asset) => asset.name)).toEqual(['latest.yml', exe])
  })
  test('on a published release, an existing asset is never replaced', async () => {
    const { api, log } = statefulGitHub(false, [{ id: 1, name: 'latest.yml', state: 'uploaded' }])
    await expect(uploadIdeAssets(api, 9, files, () => {}, noWait)).rejects.toThrow(
      "Release 2026.1.1-rc.5 is published and already has latest.yml; a published release's " +
        'assets are never replaced. Delete the asset by hand first if it must change.',
    )
    expect(log.some((line) => line.startsWith('DELETE'))).toBe(false)
    // All or nothing: the installer before it in the list is not uploaded either.
    expect(log.some((line) => line.startsWith('upload'))).toBe(false)
  })
  test('on a published release, every collision is found before the first upload', async () => {
    const { api, log } = statefulGitHub(false, [
      { id: 1, name: exe, state: 'starter' },
      { id: 2, name: 'latest.yml', state: 'uploaded' },
    ])
    await expect(uploadIdeAssets(api, 9, files, () => {}, noWait)).rejects.toThrow(
      `Release 2026.1.1-rc.5 is published and already has ${exe} (starter), latest.yml; a ` +
        "published release's assets are never replaced. Delete the assets by hand first if they " +
        'must change.',
    )
    expect(log).toEqual(['GET /repos/o/r/releases/9'])
  })
  test('on a published release, a failed upload is not cleaned up: it stops', async () => {
    const { api, log } = statefulGitHub(false, [], 1)
    await expect(uploadIdeAssets(api, 9, files, () => {}, noWait)).rejects.toThrow(
      `Uploading ${exe} to the published release 2026.1.1-rc.5 failed and left a partial asset`,
    )
    expect(log.some((line) => line.startsWith('DELETE'))).toBe(false)
  })
  test('a failed check for a partial asset is logged, and the upload is retried', async () => {
    // GET 0 is the first look at the release; GET 1 is the check after the failed upload.
    const { api, current } = statefulGitHub(true, [], 1, [1])
    const logged: string[] = []
    await uploadIdeAssets(api, 9, files, (line) => logged.push(line), noWait)
    expect(logged).toContain(`Could not check release 9 for a partial ${exe} (Error: bad gateway).`)
    expect(logged).toContain(
      `Uploading ${exe} failed (Error: connection reset); retrying in 500 ms.`,
    )
    // The partial asset it could not see is still there; a later failure would have removed it.
    expect(current().map((asset) => `${asset.name} ${asset.state}`)).toEqual([
      `${exe} starter`,
      `${exe} uploaded`,
      'latest.yml uploaded',
    ])
  })
  test('when the last check fails too, the upload error is the cause of the failure', async () => {
    // Six failed attempts; the check after the last one (GET 6) fails.
    const { api } = statefulGitHub(true, [], 6, [6])
    const failure = await uploadIdeAssets(api, 9, files, () => {}, noWait).then(
      () => null,
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe(
      `Uploading ${exe} to release 2026.1.1-rc.5 failed (Error: connection reset), and a ` +
        'partial asset it may have left could not be checked or deleted; check the release by hand.',
    )
    expect(((failure as Error).cause as Error).message).toBe('connection reset')
  })
  test('a release that does not exist is an error', async () => {
    await expect(uploadIdeAssets(fakeGitHub({}).api, 9, files, () => {})).rejects.toThrow(
      'Release 9 does not exist.',
    )
  })
})
