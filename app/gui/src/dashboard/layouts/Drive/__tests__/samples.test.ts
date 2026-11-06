/** @file The drive's samples: which rows are samples, the badge's state, and the reset entries. */
import { useToasts } from '$/providers/toasts'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import { flushPromises } from '@vue/test-utils'
import { AssetType, DirectoryId, ProjectId, type AnyAsset } from 'enso-common/src/services/Backend'
import type { SamplesStatus } from 'enso-common/src/services/ProjectManager/types'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { defineComponent, shallowReactive } from 'vue'
import { useSampleMenuEntries, useSamples, useSampleUpdateAvailable } from '../samples'

const fake = vi.hoisted(() => ({
  localBackend: null as Record<string, unknown> | null,
  openedProjects: [] as { state: { status: string; info: { id: string } }; nextTask?: unknown }[],
}))

vi.mock('$/providers/backends', () => ({
  useBackends: () => ({
    get localBackend() {
      return fake.localBackend
    },
  }),
}))
vi.mock('$/providers/openedProjects', () => ({
  useOpenedProjects: () => ({ listProjects: () => fake.openedProjects.values() }),
}))

const SAMPLES = 'C:/projects/Samples'
const STATUS = {
  directory: SAMPLES,
  samples: [
    { name: 'Sales_Overview', path: `${SAMPLES}/Sales_Overview`, state: 'updateAvailable' },
    { name: 'Text_Cleaning', path: `${SAMPLES}/Text_Cleaning`, state: 'edited' },
  ],
} as unknown as SamplesStatus

function project(path: string): AnyAsset {
  return {
    type: AssetType.project,
    id: ProjectId(`project-${encodeURIComponent(path)}`),
    title: path.split('/').at(-1),
  } as AnyAsset
}
function directory(path: string): AnyAsset {
  return {
    type: AssetType.directory,
    id: DirectoryId(`directory-${encodeURIComponent(path)}`),
    title: path.split('/').at(-1),
  } as AnyAsset
}

let samplesStatus: ReturnType<typeof vi.fn>
let resetSample: ReturnType<typeof vi.fn>
let resetAllSamples: ReturnType<typeof vi.fn>

beforeEach(() => {
  samplesStatus = vi.fn(() => Promise.resolve(STATUS))
  resetSample = vi.fn(() =>
    Promise.resolve({ kept: ['Sales_Overview_edited_2026_11_06'], unrenamed: [] as string[] }),
  )
  resetAllSamples = vi.fn(() =>
    Promise.resolve({ kept: [] as string[], unrenamed: [] as string[] }),
  )
  fake.localBackend = { samplesStatus, resetSample, resetAllSamples }
  fake.openedProjects = shallowReactive([])
})

afterEach(() => {
  vi.restoreAllMocks()
  const toasts = useToasts()
  for (const toast of toasts.toasts.value) toasts.remove(toast.id)
})

async function setup<T>(use: () => T): Promise<T> {
  let result!: T
  await mountWithProviders(
    defineComponent({
      setup() {
        result = use()
        return () => null
      },
    }),
  )
  await flushPromises()
  return result
}

describe('useSamples', () => {
  test('finds the bundled samples and the Samples folder by path', async () => {
    const samples = await setup(useSamples)
    expect(samples.sampleOf(project(`${SAMPLES}/Sales_Overview`))?.name).toBe('Sales_Overview')
    // With Windows separators too.
    expect(samples.sampleOf(project('C:\\projects\\Samples\\Text_Cleaning'))?.state).toBe('edited')
    expect(samples.sampleOf(project(`${SAMPLES}/Mine`))).toBeNull()
    expect(samples.sampleOf(directory(`${SAMPLES}/Sales_Overview`))).toBeNull()
    expect(samples.isSamplesDirectory(directory(SAMPLES))).toBe(true)
    expect(samples.isSamplesDirectory(directory('C:/projects/Other'))).toBe(false)
    expect(samples.isSamplesDirectory(project(SAMPLES))).toBe(false)
  })

  test('a host without samples makes no row a sample', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    samplesStatus.mockRejectedValue(new Error('not available'))
    const samples = await setup(useSamples)
    expect(samples.sampleOf(project(`${SAMPLES}/Sales_Overview`))).toBeNull()
    expect(samples.isSamplesDirectory(directory(SAMPLES))).toBe(false)
  })
})

describe('useSampleUpdateAvailable', () => {
  test.each([
    ['Sales_Overview', true],
    ['Text_Cleaning', false],
    ['Mine', false],
  ])('%s: %s', async (name, expected) => {
    const updateAvailable = await setup(() =>
      useSampleUpdateAvailable(() => project(`${SAMPLES}/${name}`)),
    )
    expect(updateAvailable.value).toBe(expected)
  })
})

describe('useSampleMenuEntries', () => {
  test('a sample has Reset Sample, which resets it and says what it kept', async () => {
    const entries = await setup(() =>
      useSampleMenuEntries(
        () => project(`${SAMPLES}/Sales_Overview`),
        () => false,
      ),
    )
    expect(entries.value.map((entry) => [entry.action, entry.isDisabled])).toEqual([
      ['resetSample', false],
    ])
    entries.value[0]?.doAction()
    await flushPromises()
    expect(resetSample).toHaveBeenCalledExactlyOnceWith('Sales_Overview')
    expect(useToasts().toasts.value.map((toast) => toast.content)).toContain(
      "Reset 'Sales_Overview' to the bundled version. Your edited copy is kept as " +
        "'Sales_Overview_edited_2026_11_06'.",
    )
    // The listing and the badges are refreshed.
    expect(samplesStatus).toHaveBeenCalledTimes(2)
  })

  test('an open sample has Reset Sample disabled, saying why', async () => {
    const entries = await setup(() =>
      useSampleMenuEntries(
        () => project(`${SAMPLES}/Sales_Overview`),
        () => true,
      ),
    )
    expect(entries.value).toMatchObject([
      { action: 'resetSample', isDisabled: true, tooltip: 'Close the sample to reset it' },
    ])
  })

  test('the Samples folder has Reset All Samples, disabled while a sample is open', async () => {
    const entries = await setup(() =>
      useSampleMenuEntries(
        () => directory(SAMPLES),
        () => false,
      ),
    )
    expect(entries.value).toMatchObject([{ action: 'resetAllSamples', isDisabled: false }])
    entries.value[0]?.doAction()
    await flushPromises()
    expect(resetAllSamples).toHaveBeenCalledOnce()
    expect(useToasts().toasts.value.map((toast) => toast.content)).toContain(
      'Reset the samples to the bundled version.',
    )

    fake.openedProjects.push({
      state: {
        status: 'initialized',
        info: { id: `project-${encodeURIComponent(`${SAMPLES}/Text_Cleaning`)}` },
      },
    })
    expect(entries.value).toMatchObject([
      {
        action: 'resetAllSamples',
        isDisabled: true,
        tooltip: 'Close the open samples to reset them',
      },
    ])
  })

  test('a project outside Samples, or a closed one, does not disable Reset All Samples', async () => {
    fake.openedProjects.push(
      { state: { status: 'initialized', info: { id: 'project-C%3A%2Fprojects%2FMine' } } },
      {
        state: {
          status: 'not-opened',
          info: { id: `project-${encodeURIComponent(`${SAMPLES}/Text_Cleaning`)}` },
        },
      },
    )
    const entries = await setup(() =>
      useSampleMenuEntries(
        () => directory(SAMPLES),
        () => false,
      ),
    )
    expect(entries.value).toMatchObject([{ action: 'resetAllSamples', isDisabled: false }])
  })

  test('a failed reset shows the error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    resetSample.mockRejectedValue(new Error("The sample 'Sales_Overview' is open."))
    const entries = await setup(() =>
      useSampleMenuEntries(
        () => project(`${SAMPLES}/Sales_Overview`),
        () => false,
      ),
    )
    entries.value[0]?.doAction()
    await flushPromises()
    expect(useToasts().toasts.value.map((toast) => toast.content)).toContain(
      "Could not reset 'Sales_Overview': The sample 'Sales_Overview' is open.",
    )
  })

  test("a kept copy that keeps the sample's name is a warning", async () => {
    const copy = 'Sales_Overview_edited_2026_11_06'
    resetSample.mockResolvedValue({ kept: [copy], unrenamed: [copy] })
    const entries = await setup(() =>
      useSampleMenuEntries(
        () => project(`${SAMPLES}/Sales_Overview`),
        () => false,
      ),
    )
    entries.value[0]?.doAction()
    await flushPromises()
    const warning = useToasts().toasts.value.find((toast) => toast.type === 'warning')
    expect(warning?.content).toBe(
      `The edited copy '${copy}' still has the sample's project name. Rename it in the Drive ` +
        'before you open it.',
    )
  })

  test('the samples status is not fetched again for each row', async () => {
    await setup(() => [useSamples(), useSamples(), useSamples()])
    expect(samplesStatus).toHaveBeenCalledOnce()
  })

  test('other rows have no sample entries', async () => {
    const entries = await setup(() =>
      useSampleMenuEntries(
        () => project('C:/projects/Mine'),
        () => false,
      ),
    )
    expect(entries.value).toEqual([])
  })
})
