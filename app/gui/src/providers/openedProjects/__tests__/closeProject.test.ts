import type { ProjectId } from 'enso-common/src/services/Backend'
import { LocalBackend } from 'enso-common/src/services/LocalBackend'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { effectScope } from 'vue'

const PROJECT = 'project-local-id' as ProjectId
const order: string[] = []
const localBackend = Object.create(LocalBackend.prototype) as LocalBackend
const mocks = vi.hoisted(() => ({
  offerRepository: vi.fn(),
  showCloseWarning: vi.fn(),
  closeCall: vi.fn(),
}))

vi.mock('@tanstack/vue-query', () => ({
  useQueryClient: () => ({}),
  useMutation: (options: { mutationFn?: (args: unknown) => unknown }) => ({
    mutateAsync: async (args: unknown) => options.mutationFn?.(args),
    mutate: () => {},
  }),
}))
vi.mock('@/composables/backend', () => ({ backendMutationOptions: () => ({}) }))
vi.mock('$/utils/backendQuery', () => ({
  backendMutationOptions: () => ({ mutationKey: ['k'], networkMode: 'always', meta: {} }),
}))
vi.mock('@/stores/aiAvailability', () => ({ useAiAvailability: () => ({}) }))
vi.mock('../../backends', () => ({
  useBackends: () => ({ localBackend }),
}))
vi.mock('../../text', () => ({ useText: () => ({}) }))
vi.mock('../../localVersioning', () => ({
  useLocalVersioning: () => ({
    offerRepository: mocks.offerRepository,
    showCloseWarning: mocks.showCloseWarning,
  }),
}))

import { useProjectStates, type Initialized } from '../projectStates'

function project() {
  const scope = effectScope()
  vi.spyOn(scope, 'stop').mockImplementation(() => void order.push('stop'))
  return {
    status: 'initialized',
    info: { mode: 'local', id: PROJECT, title: 'Sales' },
    scope,
  } as unknown as Initialized
}

beforeEach(() => {
  order.length = 0
  mocks.offerRepository.mockReset().mockImplementation(async () => void order.push('offer'))
  mocks.showCloseWarning.mockReset()
  localBackend.closeProjectReportingVersioning = vi.fn(async () => {
    order.push('close')
    return {}
  }) as never
})

describe('closeProject (local)', () => {
  test('offers a repository before the scope stops, then closes', async () => {
    const result = await useProjectStates().closeProject(project())
    expect(result.ok).toBe(true)
    expect(order).toEqual(['offer', 'stop', 'close'])
    expect(mocks.offerRepository).toHaveBeenCalledWith(PROJECT, 'close')
  })

  test('a throwing offer still closes the project', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.offerRepository.mockRejectedValue(new Error('boom'))
    const result = await useProjectStates().closeProject(project())
    expect(result.ok).toBe(true)
    expect(order).toEqual(['stop', 'close'])
  })

  test('does not offer when asked not to', async () => {
    await useProjectStates().closeProject(project(), { offer: false })
    expect(mocks.offerRepository).not.toHaveBeenCalled()
    expect(order).toEqual(['stop', 'close'])
  })

  test('a versioningWarning is shown, and a throwing toast does not fail the close', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    localBackend.closeProjectReportingVersioning = vi.fn(async () => ({
      versioningWarning: 'index.lock exists',
    })) as never
    mocks.showCloseWarning.mockImplementation(() => {
      throw new Error('toast')
    })
    const result = await useProjectStates().closeProject(project())
    expect(mocks.showCloseWarning).toHaveBeenCalledWith('Sales', 'index.lock exists')
    expect(result.ok).toBe(true)
  })
})
