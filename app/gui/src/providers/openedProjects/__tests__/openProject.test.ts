/** @file Opening a local project passes the engine logging settings of that moment. */
import type { ProjectId } from 'enso-common/src/services/Backend'
import { LocalBackend } from 'enso-common/src/services/LocalBackend'
import { afterEach, describe, expect, test, vi } from 'vitest'

const PROJECT = 'project-local-id' as ProjectId
const localBackend = Object.create(LocalBackend.prototype) as LocalBackend
const mocks = vi.hoisted(() => ({ calls: [] as [string, unknown][] }))

vi.mock('@tanstack/vue-query', () => ({
  useQueryClient: () => ({}),
  useMutation: (options: { mutationFn?: (args: unknown) => unknown }) => ({
    mutateAsync: async (args: unknown) => options.mutationFn?.(args),
    mutate: () => {},
  }),
}))
vi.mock('@/composables/backend', () => ({
  backendMutationOptions: (method: string) => ({
    mutationFn: (args: unknown) => void mocks.calls.push([method, args]),
  }),
}))
vi.mock('$/utils/backendQuery', () => ({ backendMutationOptions: () => ({}) }))
vi.mock('@/stores/aiAvailability', () => ({ useAiAvailability: () => ({}) }))
vi.mock('../../backends', () => ({ useBackends: () => ({ localBackend }) }))
vi.mock('../../text', () => ({ useText: () => ({}) }))
vi.mock('../../localVersioning', () => ({ useLocalVersioning: () => ({}) }))

import { setEngineLogSettings } from '../../engineLogSettings'
import { useProjectStates, type NotOpened } from '../projectStates'

const project = {
  status: 'not-opened',
  info: { mode: 'local', id: PROJECT, title: 'Sales' },
} as unknown as NotOpened

afterEach(() => {
  mocks.calls.length = 0
  setEngineLogSettings({ sqlQueries: false, performanceTimings: false })
})

describe('openProject (local)', () => {
  test('passes both logging options off by default', async () => {
    await useProjectStates().openProject(project)
    expect(mocks.calls).toEqual([
      [
        'openProject',
        [
          PROJECT,
          {
            executeAsync: false,
            engineLogging: { sqlQueries: false, performanceTimings: false },
          },
          'Sales',
        ],
      ],
    ])
  })

  test('passes the settings as they are when the project opens', async () => {
    setEngineLogSettings({ sqlQueries: true })
    await useProjectStates().openProject(project)
    setEngineLogSettings({ performanceTimings: true })
    await useProjectStates().openProject(project)
    const options = mocks.calls.map(
      ([, args]) => (args as [unknown, { engineLogging: unknown }])[1],
    )
    expect(options.map((body) => body.engineLogging)).toEqual([
      { sqlQueries: true, performanceTimings: false },
      { sqlQueries: true, performanceTimings: true },
    ])
  })
})
