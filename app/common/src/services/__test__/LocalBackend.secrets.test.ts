/** @file Local secrets: listing, create/update/delete, and that values are never read back. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SecretId } from '../Backend'
import { makeLocalBackend } from './localBackendTestUtils'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('local secrets', () => {
  it('lists secrets with secret:// paths and local: ids', async () => {
    const { projectManager, localBackend } = makeLocalBackend()
    vi.spyOn(projectManager, 'listSecrets').mockResolvedValue([
      { name: 'token', created: '2026-01-01T00:00:00Z', updated: '2026-01-01T00:00:00Z' },
    ])
    expect(await localBackend.listSecrets()).toEqual([
      { name: 'token', id: SecretId('local:token'), path: 'secret://token' },
    ])
  })

  it('creates a secret and returns its local: id, ignoring the parent directory', async () => {
    const { projectManager, localBackend } = makeLocalBackend()
    const create = vi.spyOn(projectManager, 'createSecret').mockResolvedValue()
    const id = await localBackend.createSecret({
      name: 'token',
      value: 'v1',
      parentDirectoryId: null,
    })
    expect(id).toBe(SecretId('local:token'))
    expect(create).toHaveBeenCalledWith('token', 'v1')
  })

  it('updates the secret named after local:, and refuses a missing value', async () => {
    const { projectManager, localBackend } = makeLocalBackend()
    const update = vi.spyOn(projectManager, 'updateSecret').mockResolvedValue()
    await localBackend.updateSecret(SecretId('local:token'), { title: null, value: 'v2' }, 'token')
    expect(update).toHaveBeenCalledWith('token', 'v2')
    await expect(
      localBackend.updateSecret(SecretId('local:token'), { title: 'x', value: null }, 'token'),
    ).rejects.toThrow()
  })

  it('getSecret never returns a value', async () => {
    const { localBackend } = makeLocalBackend()
    expect(await localBackend.getSecret(SecretId('local:token'), 'token')).toEqual({
      id: SecretId('local:token'),
      value: '',
    })
  })

  it('deletes by name and reports the status', async () => {
    const { projectManager, localBackend } = makeLocalBackend()
    const del = vi.spyOn(projectManager, 'deleteSecret').mockResolvedValue()
    vi.spyOn(projectManager, 'secretsStatus').mockResolvedValue({
      state: 'empty',
      keyFromEnvironment: false,
    })
    await localBackend.deleteLocalSecret('token')
    expect(del).toHaveBeenCalledWith('token')
    expect(await localBackend.secretsStatus()).toEqual({
      state: 'empty',
      keyFromEnvironment: false,
    })
  })

  it('credentials stay unsupported', () => {
    const { localBackend } = makeLocalBackend()
    expect(() => localBackend.createCredential()).toThrow()
  })
})
