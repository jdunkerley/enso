/**
 * @file The framework-free backend query and mutation options (#192): the per-method defaults,
 * defined once and the same directly and through `@/composables/backend`, and how a caller's
 * options merge with them.
 */
import {
  ACCOUNT_STALE_TIME_MS,
  backendMutationOptions,
  backendQueryDefaults,
  backendQueryOptions,
  executeMutation,
  INVALIDATION_MAP,
  STALE_TIME_MAP,
  type BackendQueryMethod,
} from '$/utils/backendQuery'
import {
  backendMutationOptions as vueBackendMutationOptions,
  backendQueryOptions as vueBackendQueryOptions,
} from '@/composables/backend'
import { QueryClient } from '@tanstack/query-core'
import { BackendType, DirectoryId, type Backend } from 'enso-common/src/services/Backend'
import { describe, expect, test, vi } from 'vitest'
import { toValue } from 'vue'

const remote = { type: BackendType.remote } as Backend
const local = { type: BackendType.local } as Backend

/**
 * The keys whose options were set differently in two places before #192, and the options they get
 * now, per the ruling on #192, except the organization and the signed-in user, which stay fresh for
 * five minutes (the maintainer's choice on #201).
 */
const RULED: Record<string, { staleTime: number; persist: boolean }> = {
  getFileDetails: { staleTime: 0, persist: true },
  searchDirectory: { staleTime: 0, persist: false },
  listTags: { staleTime: 0, persist: false },
  getOrganization: { staleTime: 5 * 60 * 1000, persist: true },
  usersMe: { staleTime: 5 * 60 * 1000, persist: true },
  listUsers: { staleTime: Infinity, persist: true },
}

describe('backendQueryOptions', () => {
  test.each(Object.entries(RULED))(
    '%s: one set of options, from React and Vue',
    (method, expected) => {
      const queryMethod = method as BackendQueryMethod
      const react = backendQueryOptions(remote, queryMethod, [] as never)
      const vue = vueBackendQueryOptions(queryMethod, [] as never, remote)
      for (const options of [react, vue]) {
        expect(options.staleTime).toBe(expected.staleTime)
        expect(options.meta.persist).toBe(expected.persist)
        expect(options.networkMode).toBe('online')
      }
      expect(toValue(vue.queryKey)).toEqual(react.queryKey)
    },
  )

  test('the organization and the signed-in user stay fresh for exactly five minutes', () => {
    expect(ACCOUNT_STALE_TIME_MS).toBe(300_000)
    expect(STALE_TIME_MAP.getOrganization).toBe(300_000)
    expect(STALE_TIME_MAP.usersMe).toBe(300_000)
  })

  test('the other keys keep the defaults: fresh for no time, persisted', () => {
    expect(backendQueryDefaults(remote, 'listSecrets')).toEqual({
      networkMode: 'online',
      staleTime: 0,
      meta: { persist: true },
    })
    expect(backendQueryDefaults(remote, 'listDirectory').meta.persist).toBe(false)
    expect(backendQueryDefaults(remote, 'getAssetDetails').meta.persist).toBe(false)
  })

  test('a local backend always runs its queries, even offline', () => {
    expect(backendQueryOptions(local, 'listSecrets', []).networkMode).toBe('always')
    expect(toValue(vueBackendQueryOptions('listSecrets', [], local).networkMode)).toBe('always')
  })

  test("the key is the backend type, the method and its arguments, then the caller's extra key", () => {
    expect(
      backendQueryOptions(remote, 'listSecrets', [], { queryKey: ['extra'] }).queryKey,
    ).toEqual([BackendType.remote, 'listSecrets', 'extra'])
    const parentId = DirectoryId('directory-1')
    const listDirectoryArgs = [
      {
        parentId,
        labels: null,
        filterBy: null,
        recentProjects: false,
        sortExpression: null,
        sortDirection: null,
        from: null,
        pageSize: null,
      },
      'title',
    ] as const
    // `listDirectory` puts its parent first, so that a directory's listings share a key prefix.
    expect(backendQueryOptions(remote, 'listDirectory', listDirectoryArgs).queryKey).toEqual([
      BackendType.remote,
      'listDirectory',
      parentId,
      {
        labels: null,
        filterBy: null,
        recentProjects: false,
        sortExpression: null,
        sortDirection: null,
        from: null,
        pageSize: null,
      },
    ])
  })

  test("a caller's stale time wins; a method that is never persisted stays unpersisted", () => {
    const options = backendQueryOptions(remote, 'getOrganization', [], {
      staleTime: 5,
      meta: { persist: false },
      enabled: false,
    })
    expect(options.staleTime).toBe(5)
    expect(options.meta.persist).toBe(false)
    expect(options.enabled).toBe(false)
    expect(
      backendQueryOptions(remote, 'listTags', [], { meta: { persist: true } }).meta.persist,
    ).toBe(false)
  })

  test('the query calls the method with its arguments, on its backend', async () => {
    const listSecrets = vi.fn(function (this: Backend) {
      expect(this).toBe(backend)
      return Promise.resolve([])
    })
    const backend = { type: BackendType.remote, listSecrets } as unknown as Backend
    await expect(backendQueryOptions(backend, 'listSecrets', []).queryFn()).resolves.toEqual([])
    expect(listSecrets).toHaveBeenCalledOnce()
  })
})

describe('backendMutationOptions', () => {
  test("invalidates the caller's keys, then the method's, and awaits them", () => {
    const options = backendMutationOptions(remote, 'createTag', {
      meta: { invalidates: [['custom']] },
    })
    expect(options.mutationKey).toEqual([BackendType.remote, 'createTag'])
    expect(options.meta).toEqual({
      invalidates: [['custom'], [BackendType.remote, 'listTags']],
      awaitInvalidates: true,
      refetchType: 'active',
    })
    expect(INVALIDATION_MAP.createTag).toEqual(['listTags'])
  })

  test('refetches every listing, not only the active ones, after a change to the drive', () => {
    expect(backendMutationOptions(remote, 'createDirectory').meta?.refetchType).toBe('all')
  })

  test('`invalidate: false` turns the invalidations off', () => {
    expect(
      backendMutationOptions(remote, 'createDirectory', { invalidate: false }).meta?.invalidates,
    ).toEqual([])
  })

  test('Vue gets the same options, its mutation key appended', () => {
    const vue = toValue(
      vueBackendMutationOptions('updateAsset', remote, { mutationKey: ['editDescription'] }),
    )
    const react = backendMutationOptions(remote, 'updateAsset', {
      mutationKey: ['editDescription'],
    })
    expect(vue.mutationKey).toEqual(react.mutationKey)
    expect(vue.meta).toEqual(react.meta)
    expect(vue.networkMode).toBe(react.networkMode)
  })

  test('executeMutation runs it through the mutation cache, outside any component', async () => {
    const createTag = vi.fn(() => Promise.resolve({ id: 'tag-1' }))
    const backend = { type: BackendType.remote, createTag } as unknown as Backend
    const queryClient = new QueryClient()
    const options = backendMutationOptions(backend, 'createTag')
    await expect(executeMutation(queryClient, options, [{} as never])).resolves.toEqual({
      id: 'tag-1',
    })
    expect(queryClient.getMutationCache().getAll()).toHaveLength(1)
  })
})
