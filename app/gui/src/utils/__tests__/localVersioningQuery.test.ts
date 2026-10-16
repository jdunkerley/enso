import { BackendType, Path } from 'enso-common/src/services/Backend'
import type { LocalBackend } from 'enso-common/src/services/LocalBackend'
import { describe, expect, test, vi } from 'vitest'
import { localVersioningStatusQueryOptions } from '../localVersioningQuery'

describe('localVersioningStatusQueryOptions', () => {
  test('reads the status of the path, keyed by it', async () => {
    const versioningStatus = vi.fn(async () => ({ git: true }))
    const backend = { versioningStatus } as unknown as LocalBackend
    const options = localVersioningStatusQueryOptions(backend, Path('/root/P'))
    expect(options.queryKey).toEqual([BackendType.local, 'versioningStatus', '/root/P'])
    expect(options.enabled).toBe(true)
    expect(options.meta).toEqual({ persist: false })
    expect(await options.queryFn()).toEqual({ git: true })
    expect(versioningStatus).toHaveBeenCalledWith('/root/P')
  })

  test('without a path or a backend it is disabled, and reads nothing', async () => {
    const versioningStatus = vi.fn()
    const backend = { versioningStatus } as unknown as LocalBackend
    expect(localVersioningStatusQueryOptions(backend, null).enabled).toBe(false)
    expect(localVersioningStatusQueryOptions(null, Path('/root/P')).enabled).toBe(false)
    expect(await localVersioningStatusQueryOptions(backend, null).queryFn()).toBeNull()
    expect(versioningStatus).not.toHaveBeenCalled()
  })
})
