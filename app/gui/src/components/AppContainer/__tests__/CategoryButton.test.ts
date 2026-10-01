import ConfirmDeleteModal from '$/components/AlertDialog/ConfirmDeleteModal.vue'
import type { Category } from '$/providers/category'
import { useModals } from '$/providers/modals'
import type { ReactApi } from '$/providers/reactApi'
import { useText } from '$/providers/text'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import type { VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { reactive } from 'vue'
import CategoryButton from '../CategoryButton.vue'

// `useCategories` and `useContainerData` are global stores (see `mountWithProviders`), so they are
// replaced here by module mocks; everything else in these modules stays real.
const removeLocalDirectory = vi.fn()
vi.mock('$/providers/category', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$/providers/category')>()),
  useCategories: () => ({
    categoryLabel: (category: Category) =>
      category.type === 'localDirectory' ?
        'Projects'
      : useText().getText(`${category.type}Category` as 'cloudCategory'),
    removeLocalDirectory,
  }),
}))
const containerData = reactive({ leftPanelShown: true, leftPanelToggledOn: false })
vi.mock('$/providers/container', () => ({ useContainerData: () => containerData }))

function makeReactApi(): ReactApi {
  return {
    startTransition: (action) => action(),
    isTransitioning: false,
    transferBetweenCategories: vi.fn(),
  }
}

function mountCategoryButton(category: Category, props: { extended?: boolean } = {}) {
  const drive = reactive({ currentCategory: { type: 'local' } as Category })
  const reactApi = makeReactApi()
  return mountWithProviders(CategoryButton, {
    props: { category, ...props },
    stores: { drive, reactApi },
    routes: [{ path: '/settings', component: { render: () => null } }],
  }).then((mounted) => ({ ...mounted, drive, reactApi }))
}

/** Press a `MenuButton`: it acts on the state it saw at `pointerdown`, as a real click has one. */
async function press(wrapper: VueWrapper, index = 0) {
  const button = wrapper.findAll('button')[index]!
  await button.trigger('pointerdown')
  await button.trigger('click')
}

describe('CategoryButton', () => {
  beforeEach(() => {
    containerData.leftPanelShown = true
    containerData.leftPanelToggledOn = false
  })

  test('is labelled with the category name, from the text store', async () => {
    const { wrapper } = await mountCategoryButton({ type: 'cloud' })
    expect(wrapper.find('button').attributes('aria-label')).toBe('Cloud')
  })

  test('switches the drive to its category when pressed', async () => {
    const { wrapper, drive } = await mountCategoryButton({ type: 'trash' })
    await press(wrapper)
    expect(drive.currentCategory).toEqual({ type: 'trash' })
  })

  test('opens the left panel when it is collapsed', async () => {
    containerData.leftPanelShown = false
    const { wrapper } = await mountCategoryButton({ type: 'cloud' })
    await press(wrapper)
    expect(containerData.leftPanelToggledOn).toBe(true)
  })

  test("the extended Local button's settings button opens the Local settings tab", async () => {
    const { wrapper, router } = await mountCategoryButton({ type: 'local' }, { extended: true })
    expect(wrapper.findAll('button')).toHaveLength(2)
    await press(wrapper, 1)
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/settings'))
    expect(router.currentRoute.value.query).toEqual({ 'cloud-ide_SettingsTab': '"local"' })
  })

  test("the extended local directory's remove button asks first, through the modal stack", async () => {
    removeLocalDirectory.mockClear()
    const modals = useModals()
    const { wrapper } = await mountCategoryButton(
      { type: 'localDirectory', path: '/home/projects' } as Category,
      { extended: true },
    )
    await press(wrapper, 1)
    const entry = modals.stack.value.at(-1)!
    expect(entry.component).toBe(ConfirmDeleteModal)
    expect(entry.props).toMatchObject({
      actionText: "remove the local folder 'Projects' from your sidebar",
      actionButtonLabel: 'Remove',
    })
    expect(removeLocalDirectory).not.toHaveBeenCalled()
    await (entry.props.onConfirm as () => Promise<void>)()
    expect(removeLocalDirectory).toHaveBeenCalledWith('/home/projects')
    modals.closeAll()
  })
})
