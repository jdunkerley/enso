/**
 * @file The drive's samples: which rows are samples, which have an update, Update Sample (with its
 * confirmation) and the toolbar's Update All.
 */
import { useModals } from '$/providers/modals'
import { useToasts } from '$/providers/toasts'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import { flushPromises } from '@vue/test-utils'
import { AssetType, DirectoryId, ProjectId, type AnyAsset } from 'enso-common/src/services/Backend'
import type {
  SamplesStatus,
  SamplesUpdateResult,
} from 'enso-common/src/services/ProjectManager/types'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { defineComponent, ref, shallowReactive } from 'vue'
import {
  useSampleMenuEntries,
  useSamples,
  useSampleWithUpdate,
  useUpdateAllButton,
  type SampleEntry,
} from '../samples'
import UpdateSamplesModal from '../UpdateSamplesModal.vue'

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
const SALES: SampleEntry = {
  name: 'Sales_Overview',
  path: `${SAMPLES}/Sales_Overview`,
  state: 'updateAvailable',
  route: 'copy',
  copyName: 'Sales_Overview_edited_2026_11_06',
  ignoredChanges: [],
} as SampleEntry
const ORDERS: SampleEntry = {
  name: 'Orders_And_Customers',
  path: `${SAMPLES}/Orders_And_Customers`,
  state: 'updateAvailable',
  route: 'version',
  copyName: null,
  ignoredChanges: [],
} as SampleEntry
const TEXT_CLEANING: SampleEntry = {
  name: 'Text_Cleaning',
  path: `${SAMPLES}/Text_Cleaning`,
  state: 'edited',
  route: 'copy',
  copyName: 'Text_Cleaning_edited_2026_11_06',
  ignoredChanges: [],
} as SampleEntry
const GETTING_STARTED: SampleEntry = {
  name: 'Getting_Started',
  path: `${SAMPLES}/Getting_Started`,
  state: 'current',
  route: null,
  copyName: null,
  ignoredChanges: [],
} as SampleEntry
const STATUS = {
  directory: SAMPLES,
  samples: [SALES, ORDERS, TEXT_CLEANING, GETTING_STARTED],
} as SamplesStatus

function project(path: string, state = 'closed'): AnyAsset {
  return {
    type: AssetType.project,
    id: ProjectId(`project-${encodeURIComponent(path)}`),
    title: path.split('/').at(-1),
    projectState: { type: state },
  } as AnyAsset
}
function directory(path: string): AnyAsset {
  return {
    type: AssetType.directory,
    id: DirectoryId(`directory-${encodeURIComponent(path)}`),
    title: path.split('/').at(-1),
  } as AnyAsset
}
const directoryId = (path: string) => DirectoryId(`directory-${encodeURIComponent(path)}`)
function opened(path: string) {
  return { state: { status: 'initialized', info: { id: `project-${encodeURIComponent(path)}` } } }
}

function result(fields: Partial<SamplesUpdateResult>): SamplesUpdateResult {
  return {
    updated: [],
    versioned: [],
    kept: [],
    unrenamed: [],
    fellBack: [],
    failed: [],
    ...fields,
  }
}

let samplesStatus: ReturnType<typeof vi.fn>
let updateSample: ReturnType<typeof vi.fn>
let updateAllSamples: ReturnType<typeof vi.fn>

beforeEach(() => {
  samplesStatus = vi.fn(() => Promise.resolve(STATUS))
  updateSample = vi.fn((name: string) =>
    Promise.resolve(result({ updated: [name], kept: [`${name}_edited_2026_11_06`] })),
  )
  updateAllSamples = vi.fn(() =>
    Promise.resolve(
      result({
        updated: ['Sales_Overview', 'Orders_And_Customers'],
        versioned: ['Orders_And_Customers'],
        kept: ['Sales_Overview_edited_2026_11_06'],
      }),
    ),
  )
  fake.localBackend = { samplesStatus, updateSample, updateAllSamples }
  fake.openedProjects = shallowReactive([])
  useModals().closeAll()
})

afterEach(() => {
  vi.restoreAllMocks()
  const toasts = useToasts()
  for (const toast of toasts.toasts.value) toasts.remove(toast.id)
})

async function setup<T>(use: () => T): Promise<T> {
  let value!: T
  await mountWithProviders(
    defineComponent({
      setup() {
        value = use()
        return () => null
      },
    }),
  )
  await flushPromises()
  return value
}

const toastContents = () => useToasts().toasts.value.map((toast) => [toast.type, toast.content])

/** The update confirmation on the modal stack. */
async function confirmation() {
  await flushPromises()
  const entry = useModals().stack.value.at(-1)
  expect(entry?.component).toBe(UpdateSamplesModal)
  return entry?.props as { samples: readonly SampleEntry[]; onConfirm: () => Promise<void> }
}

describe('useSamples', () => {
  test('finds the bundled samples, their updates and the Samples folder by path', async () => {
    const samples = await setup(useSamples)
    expect(samples.sampleOf(project(`${SAMPLES}/Sales_Overview`))?.name).toBe('Sales_Overview')
    // With Windows separators too.
    expect(samples.sampleOf(project('C:\\projects\\Samples\\Text_Cleaning'))?.state).toBe('edited')
    expect(samples.sampleOf(project(`${SAMPLES}/Mine`))).toBeNull()
    expect(samples.sampleOf(directory(`${SAMPLES}/Sales_Overview`))).toBeNull()
    expect(samples.isSamplesDirectoryId(directoryId(SAMPLES))).toBe(true)
    expect(samples.isSamplesDirectoryId(directoryId('C:\\projects\\Samples\\'))).toBe(true)
    expect(samples.isSamplesDirectoryId(directoryId('C:/projects/Other'))).toBe(false)
    expect(samples.withUpdates.value.map((sample) => sample.name)).toEqual([
      'Sales_Overview',
      'Orders_And_Customers',
    ])
  })

  test('a host without samples makes no row a sample, and no folder Samples', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    samplesStatus.mockRejectedValue(new Error('not available'))
    const samples = await setup(useSamples)
    expect(samples.sampleOf(project(`${SAMPLES}/Sales_Overview`))).toBeNull()
    expect(samples.isSamplesDirectoryId(directoryId(SAMPLES))).toBe(false)
  })

  test('the samples status is not fetched again for each row', async () => {
    await setup(() => [useSamples(), useSamples(), useSamples()])
    expect(samplesStatus).toHaveBeenCalledOnce()
  })
})

describe('useSampleWithUpdate', () => {
  test.each([
    ['Sales_Overview', true],
    ['Text_Cleaning', false],
    ['Mine', false],
  ])('%s: %s', async (name, expected) => {
    const sample = await setup(() => useSampleWithUpdate(() => project(`${SAMPLES}/${name}`)))
    expect(sample.value != null).toBe(expected)
  })
})

describe('Update Sample', () => {
  const menuFor = (sample: SampleEntry, isOpen = false) =>
    setup(() =>
      useSampleMenuEntries(
        () => project(sample.path),
        () => isOpen,
      ),
    )

  test('asks first, saying the edited copy it keeps, then updates and says so', async () => {
    const entries = await menuFor(SALES)
    expect(entries.value.map((entry) => [entry.action, entry.isDisabled])).toEqual([
      ['updateSample', false],
    ])
    entries.value[0]?.doAction()
    expect(updateSample).not.toHaveBeenCalled()
    const asked = await confirmation()
    expect(asked.samples).toEqual([SALES])
    await asked.onConfirm()
    expect(updateSample).toHaveBeenCalledExactlyOnceWith('Sales_Overview')
    expect(toastContents()).toContainEqual([
      'success',
      "Updated 'Sales_Overview'. Your edited copy is kept as 'Sales_Overview_edited_2026_11_06'.",
    ])
    // The listing and the pills are refreshed.
    // Asked again before the confirmation, and after the update.
    expect(samplesStatus).toHaveBeenCalledTimes(3)
  })

  test('says when the previous version is in version history', async () => {
    updateSample.mockResolvedValue(
      result({ updated: ['Orders_And_Customers'], versioned: ['Orders_And_Customers'] }),
    )
    const entries = await menuFor(ORDERS)
    entries.value[0]?.doAction()
    await (await confirmation()).onConfirm()
    expect(toastContents()).toEqual([
      [
        'success',
        "Updated 'Orders_And_Customers'. Your previous version is in its version history.",
      ],
    ])
  })

  test('warns when the version could not be saved and a copy was kept instead', async () => {
    updateSample.mockResolvedValue(
      result({
        updated: ['Orders_And_Customers'],
        kept: ['Orders_And_Customers_edited_2026_11_06'],
        fellBack: [{ name: 'Orders_And_Customers', error: 'index.lock exists' }],
      }),
    )
    const entries = await menuFor(ORDERS)
    entries.value[0]?.doAction()
    await (await confirmation()).onConfirm()
    expect(toastContents()).toEqual([
      [
        'success',
        "Updated 'Orders_And_Customers'. Your edited copy is kept as " +
          "'Orders_And_Customers_edited_2026_11_06'.",
      ],
      [
        'warning',
        "'Orders_And_Customers' could not be saved in version history (index.lock exists), so " +
          'your edited copy was kept beside it instead.',
      ],
    ])
  })

  test('updates a sample with no edits of the user without asking', async () => {
    updateSample.mockResolvedValue(result({ updated: ['Getting_Started'] }))
    const entries = await menuFor(GETTING_STARTED)
    entries.value[0]?.doAction()
    await flushPromises()
    expect(useModals().stack.value).toEqual([])
    expect(updateSample).toHaveBeenCalledExactlyOnceWith('Getting_Started')
    expect(toastContents()).toEqual([['success', "Updated 'Getting_Started'."]])
  })

  test('is disabled for an open sample, saying why', async () => {
    const entries = await menuFor(SALES, true)
    expect(entries.value).toMatchObject([
      { action: 'updateSample', isDisabled: true, tooltip: 'Close the sample to update it' },
    ])
  })

  test('a failed update shows the error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    updateSample.mockRejectedValue(new Error("The sample 'Sales_Overview' is open."))
    const entries = await menuFor(SALES)
    entries.value[0]?.doAction()
    await (await confirmation()).onConfirm()
    expect(toastContents()).toContainEqual([
      'error',
      "Could not update 'Sales_Overview': The sample 'Sales_Overview' is open.",
    ])
  })

  test("a kept copy that keeps the sample's name is a warning", async () => {
    const copy = 'Sales_Overview_edited_2026_11_06'
    updateSample.mockResolvedValue(
      result({ updated: ['Sales_Overview'], kept: [copy], unrenamed: [copy] }),
    )
    const entries = await menuFor(SALES)
    entries.value[0]?.doAction()
    await (await confirmation()).onConfirm()
    const warning = useToasts().toasts.value.find((toast) => toast.type === 'warning')
    expect(warning?.content).toBe(
      `The edited copy '${copy}' still has the sample's project name. Rename it in the Drive ` +
        'before you open it.',
    )
  })

  test('the Samples folder and other rows have no sample entries', async () => {
    for (const asset of [directory(SAMPLES), project('C:/projects/Mine')]) {
      const entries = await setup(() =>
        useSampleMenuEntries(
          () => asset,
          () => false,
        ),
      )
      expect(entries.value).toEqual([])
    }
  })
})

describe('Update All', () => {
  test('is shown only in the Samples folder', async () => {
    expect((await setup(() => useUpdateAllButton(() => directoryId(SAMPLES)))).isShown.value).toBe(
      true,
    )
    expect(
      (await setup(() => useUpdateAllButton(() => directoryId('C:/projects')))).isShown.value,
    ).toBe(false)
  })

  test('asks first, listing only the samples with an update, then updates them', async () => {
    const button = await setup(() => useUpdateAllButton(() => directoryId(SAMPLES)))
    expect(button.isDisabled.value).toBe(false)
    expect(button.tooltip.value).toBe('Update every sample that has a newer version')
    void button.run()
    const asked = await confirmation()
    expect(asked.samples.map((sample) => sample.name)).toEqual([
      'Sales_Overview',
      'Orders_And_Customers',
    ])
    expect(updateAllSamples).not.toHaveBeenCalled()
    await asked.onConfirm()
    expect(updateAllSamples).toHaveBeenCalledOnce()
    expect(toastContents()).toEqual([
      [
        'success',
        'Updated the samples: Sales_Overview, Orders_And_Customers. Your previous versions are ' +
          'in version history: Orders_And_Customers. Your edited copies are kept: ' +
          'Sales_Overview_edited_2026_11_06.',
      ],
    ])
  })

  test('is disabled, saying why, when no sample has an update', async () => {
    samplesStatus.mockResolvedValue({
      directory: SAMPLES,
      samples: [TEXT_CLEANING, GETTING_STARTED],
    })
    const button = await setup(() => useUpdateAllButton(() => directoryId(SAMPLES)))
    expect(button.isShown.value).toBe(true)
    expect(button.isDisabled.value).toBe(true)
    expect(button.tooltip.value).toBe('Every sample is up to date')
  })

  test('is disabled while a sample it would update is open, and not for another', async () => {
    const button = await setup(() => useUpdateAllButton(() => directoryId(SAMPLES)))
    fake.openedProjects.push(opened(`${SAMPLES}/Text_Cleaning`), opened('C:/projects/Mine'))
    expect(button.isDisabled.value).toBe(false)
    fake.openedProjects.push(opened(`${SAMPLES}/Orders_And_Customers`))
    expect(button.isDisabled.value).toBe(true)
    expect(button.tooltip.value).toBe('Close the open samples to update them')
  })

  test('that fails part way says what failed, and what it kept', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    updateAllSamples.mockResolvedValue(
      result({
        updated: ['Orders_And_Customers'],
        kept: ['Orders_And_Customers_edited_2026_11_06'],
        failed: [{ name: 'Sales_Overview', error: 'EBUSY: resource busy or locked' }],
      }),
    )
    const button = await setup(() => useUpdateAllButton(() => directoryId(SAMPLES)))
    void button.run()
    await (await confirmation()).onConfirm()
    expect(toastContents()).toEqual([
      ['error', 'Some samples were not updated: Sales_Overview (EBUSY: resource busy or locked)'],
      ['info', 'Your edited copies are kept: Orders_And_Customers_edited_2026_11_06.'],
    ])
  })

  test('with nothing left to update, says so and asks nothing', async () => {
    const button = await setup(() => useUpdateAllButton(() => directoryId(SAMPLES)))
    // Another window updated them meanwhile: the states asked for again have no update.
    samplesStatus.mockResolvedValue({ directory: SAMPLES, samples: [TEXT_CLEANING] })
    await button.run()
    await flushPromises()
    expect(useModals().stack.value).toEqual([])
    expect(updateAllSamples).not.toHaveBeenCalled()
    expect(toastContents()).toEqual([['info', 'Nothing to update: every sample is up to date.']])
  })

  test('that updated nothing says so, not "Updated the samples: ."', async () => {
    updateAllSamples.mockResolvedValue(result({}))
    const button = await setup(() => useUpdateAllButton(() => directoryId(SAMPLES)))
    void button.run()
    await (await confirmation()).onConfirm()
    expect(toastContents()).toEqual([['info', 'Nothing to update: every sample is up to date.']])
  })

  test('entering the Samples folder asks for the states again', async () => {
    const folder = ref(directoryId('C:/projects'))
    await setup(() => useUpdateAllButton(() => folder.value))
    const asked = samplesStatus.mock.calls.length
    folder.value = directoryId(SAMPLES)
    await flushPromises()
    expect(samplesStatus.mock.calls.length).toBe(asked + 1)
  })
})

describe('the confirmation names the current route', () => {
  test('the states are asked for again before it opens', async () => {
    const entries = await setup(() =>
      useSampleMenuEntries(
        () => project(SALES.path),
        () => false,
      ),
    )
    // Versioning was turned on since the states were read.
    const versioned = { ...SALES, route: 'version', copyName: null } as SampleEntry
    samplesStatus.mockResolvedValue({ directory: SAMPLES, samples: [versioned] })
    entries.value[0]?.doAction()
    expect((await confirmation()).samples).toEqual([versioned])
  })
})
