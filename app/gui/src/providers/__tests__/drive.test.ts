/**
 * @file The drive's location (#90): a change of category or directory runs in the drive's
 * transition when it has one, and `isNavigating` is the drive's to set.
 */
import { provideDriveLocation, type DriveLocationStore } from '$/providers/drive'
import LocalStorage from '$/utils/LocalStorage'
import { mount } from '@vue/test-utils'
import type { DirectoryId } from 'enso-common/src/services/Backend'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { defineComponent, reactive } from 'vue'

vi.mock('$/providers/backends', () => ({
  useBackends: () => ({ localBackend: {}, backendForType: () => ({}) }),
}))
vi.mock('$/providers/auth', () => ({ useAuth: () => reactive({ session: null }) }))
vi.mock('$/providers/category', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$/providers/category')>()),
  useCategories: () =>
    reactive({
      localCategoriesList: [{ type: 'local' }],
      cloudCategoriesList: [{ type: 'cloud' }],
    }),
}))

afterEach(() => {
  LocalStorage.getInstance().delete('driveDisplay')
})

function mountDriveLocation() {
  let store: DriveLocationStore | undefined
  mount(
    defineComponent({
      setup() {
        store = provideDriveLocation()
        return () => null
      },
    }),
  )
  return store!
}

const CHILD = 'directory-child' as DirectoryId

describe('the drive location', () => {
  test('a change applies at once', () => {
    const drive = mountDriveLocation()
    drive.currentDirectory = CHILD
    expect(drive.currentDirectory).toBe(CHILD)
  })

  test('`isNavigating` starts false and is set by the drive', () => {
    const drive = mountDriveLocation()
    expect(drive.isNavigating).toBe(false)
    drive.isNavigating = true
    expect(drive.isNavigating).toBe(true)
  })
})
