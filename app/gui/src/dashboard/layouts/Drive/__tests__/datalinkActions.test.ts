/** @file "New Datalink" and opening a datalink: the dialog's props, and what a save writes. */
import { useModals } from '$/providers/modals'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import {
  AssetType,
  BackendType,
  DatalinkId,
  DirectoryId,
  type Backend,
  type DatalinkAsset,
} from 'enso-common/src/services/Backend'
import { afterEach, expect, test, vi } from 'vitest'
import { defineComponent } from 'vue'
import { useEditDatalink, useNewDatalink } from '../datalinkActions'

const VALUE = { type: 'S3', libraryName: 'Standard.AWS', uri: 's3://b/k' }
const ASSET = {
  type: AssetType.datalink,
  id: DatalinkId('datalink-%2Froot%2FSales.datalink'),
  title: 'Sales',
  parentId: DirectoryId('directory-%2Froot'),
} as DatalinkAsset

async function setup(backend: Partial<Backend>) {
  let actions!: {
    edit: ReturnType<typeof useEditDatalink>
    create: ReturnType<typeof useNewDatalink>
  }
  const full = { type: BackendType.local, ...backend } as Backend
  await mountWithProviders(
    defineComponent({
      setup() {
        actions = { edit: useEditDatalink(full), create: useNewDatalink(full) }
        return () => null
      },
    }),
  )
  return actions
}
interface DialogProps {
  existing?: { name: string; value: unknown }
  doCreate: (name: string, value: unknown) => Promise<void>
}
function topProps() {
  const top = useModals().stack.value.at(-1)
  if (top == null) throw new Error('No dialog is open.')
  return top.props as unknown as DialogProps
}

afterEach(() => {
  useModals().closeAll()
  vi.restoreAllMocks()
})

test('opening reads the file, and saving rewrites that datalink', async () => {
  const createDatalink = vi.fn().mockResolvedValue({ id: ASSET.id })
  const { edit } = await setup({
    getDatalink: vi.fn().mockResolvedValue(VALUE),
    createDatalink,
  })
  await edit(ASSET)
  expect(topProps().existing).toEqual({ name: 'Sales', value: VALUE })
  await topProps().doCreate('Sales', { ...VALUE, uri: 's3://b/new' })
  expect(createDatalink).toHaveBeenCalledExactlyOnceWith({
    name: 'Sales',
    value: { ...VALUE, uri: 's3://b/new' },
    parentDirectoryId: ASSET.parentId,
    datalinkId: ASSET.id,
  })
})

test('a datalink that cannot be read opens no dialog, and says why', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const { edit } = await setup({
    getDatalink: vi.fn().mockRejectedValue(new Error("'Sales.datalink' is not valid JSON")),
  })
  await edit(ASSET)
  expect(useModals().stack.value).toEqual([])
  expect(error).toHaveBeenCalledWith(expect.stringContaining('is not valid JSON'))
})

test('New Datalink creates in the given folder', async () => {
  const createDatalink = vi.fn().mockResolvedValue({ id: ASSET.id })
  const { create } = await setup({ createDatalink })
  create(ASSET.parentId)
  expect(topProps().existing).toBeUndefined()
  await topProps().doCreate('Sales', VALUE)
  expect(createDatalink).toHaveBeenCalledExactlyOnceWith({
    name: 'Sales',
    value: VALUE,
    parentDirectoryId: ASSET.parentId,
    datalinkId: null,
  })
})
