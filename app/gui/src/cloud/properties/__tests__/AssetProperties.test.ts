/**
 * @file The right panel's Properties tab (#183): what it shows for each selection, the secret and
 * datalink configuration, and the spotlight the asset's "Edit" opens. The datalink editor is
 * replaced by a stub: it has tests of its own (`$/cloud/datalinks/__tests__/`).
 */
import type { Category } from '$/providers/category'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import {
  AssetType,
  DatalinkId,
  DirectoryId,
  EmailAddress,
  FileId,
  OrganizationId,
  Plan,
  SecretId,
  UserId,
  type AnyAsset,
  type User,
} from 'enso-common/src/services/Backend'
import { PermissionAction } from 'enso-common/src/utilities/permissions'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { reactive, ref } from 'vue'
import AssetProperties from '../AssetProperties.vue'

const backend = vi.hoisted(() => ({
  type: 'remote',
  listTags: vi.fn(),
  getDatalink: vi.fn(),
  createDatalink: vi.fn(),
  updateSecret: vi.fn(),
}))
vi.mock('$/providers/backends', () => ({ useBackends: () => ({ remoteBackend: backend }) }))

const user = vi.hoisted(() => ({ value: undefined as unknown }))
vi.mock('$/providers/auth', () => ({
  useAuth: () => ({
    get session() {
      return { user: user.value }
    },
  }),
}))

// The datalink editor, stubbed: an input holding the datalink's `uri`.
vi.mock('../../datalinks/DatalinkInput.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      props: { value: Object, readOnly: Boolean, dropdownTitle: String },
      emits: ['change'],
      setup(props, { emit }) {
        return () =>
          h('input', {
            'data-testid': 'datalink-stub',
            'data-dropdown-title': props.dropdownTitle,
            readOnly: props.readOnly,
            value: (props.value as { uri?: string } | null)?.uri ?? '',
            onInput: (event: Event) =>
              emit('change', {
                ...(props.value as object),
                uri: (event.target as HTMLInputElement).value,
              }),
          })
      },
    }),
  }
})

const ORGANIZATION_ID = OrganizationId('organization-1')
const SELF: User = {
  userId: UserId('user-self'),
  organizationId: ORGANIZATION_ID,
  name: 'Me',
  email: EmailAddress('me@example.com'),
  plan: Plan.solo,
} as unknown as User
const OWNER = {
  userId: UserId('user-ada'),
  organizationId: ORGANIZATION_ID,
  name: 'Ada Lovelace',
  email: EmailAddress('ada@example.com'),
}
const DATALINK = {
  type: 'HTTP',
  libraryName: 'Standard.Base',
  uri: 'https://example.com/data.csv',
  method: 'GET',
}

function asset(type: AssetType, extra: Record<string, unknown> = {}): AnyAsset {
  const ids: Partial<Record<AssetType, string>> = {
    [AssetType.file]: FileId('file-1'),
    [AssetType.secret]: SecretId('secret-1'),
    [AssetType.datalink]: DatalinkId('datalink-1'),
  }
  return {
    type,
    id: ids[type] ?? 'project-1',
    title: 'Customers',
    parentId: DirectoryId('directory-parent'),
    ensoPath: 'enso://Users/me/Customers',
    modifiedAt: '2026-10-01T10:00:00Z',
    createdAt: '2026-09-30T09:00:00Z',
    labels: ['Important', 'Gone'],
    permissions: [
      { permission: PermissionAction.own, user: OWNER },
      { permission: PermissionAction.edit, user: SELF },
    ],
    ...extra,
  } as unknown as AnyAsset
}

const category = ref<Category>({ type: 'cloud' })
const focused = ref<AnyAsset>()
const spotlightOn = ref<'datalink' | 'secret'>()
const updateContext = vi.fn((_panel: unknown, f: (ctx: object) => object) => {
  f(rightPanel.context)
})
const rightPanel = reactive({
  context: {
    get category() {
      return category.value
    },
    get spotlightOn() {
      return spotlightOn.value
    },
    set spotlightOn(value) {
      spotlightOn.value = value
    },
  },
  focusedAsset: focused,
  updateContext,
})

let portalRoot: HTMLElement
let spotlightRoot: HTMLElement
beforeEach(() => {
  portalRoot = document.createElement('div')
  portalRoot.id = 'enso-portal-root'
  document.body.appendChild(portalRoot)
  spotlightRoot = document.createElement('div')
  spotlightRoot.className = 'enso-spotlight'
  document.body.appendChild(spotlightRoot)
  category.value = { type: 'cloud' }
  focused.value = asset(AssetType.project)
  spotlightOn.value = undefined
  user.value = SELF
  backend.listTags.mockResolvedValue([
    { id: 'tag-1', value: 'Important', color: { lightness: 50, chroma: 66, hue: 7 } },
  ])
  backend.getDatalink.mockResolvedValue(DATALINK)
  backend.createDatalink.mockResolvedValue({})
  backend.updateSecret.mockResolvedValue(undefined)
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  portalRoot.remove()
  spotlightRoot.remove()
  vi.clearAllMocks()
})

async function renderTab() {
  const mounted = await mountWithProviders(AssetProperties, { stores: { rightPanel } })
  await flushPromises()
  return mounted
}

const byTestId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)

describe('placeholders', () => {
  test('outside the cloud', async () => {
    category.value = { type: 'local' }
    const { wrapper } = await renderTab()
    expect(wrapper.text()).toContain('Properties are not available for local assets.')
  })

  test('with nothing selected', async () => {
    focused.value = undefined
    const { wrapper } = await renderTab()
    expect(wrapper.text()).toContain('Select a single asset to view its properties.')
  })
})

describe('properties', () => {
  test('the path, owner, dates and known labels', async () => {
    await renderTab()
    expect(byTestId('asset-panel-path')?.textContent).toContain('enso://Users/me/Customers')
    expect(byTestId('asset-panel-owner')?.textContent).toContain('Ada Lovelace')
    expect(byTestId('asset-panel-modified-at')?.textContent).toContain('2026-10-01')
    expect(byTestId('asset-panel-created-at')?.textContent).toContain('2026-09-30')
    // Only the labels the organization has.
    const labels = byTestId('asset-panel-labels')?.textContent ?? ''
    expect(labels).toContain('Important')
    expect(labels).not.toContain('Gone')
    // No size for a project, no creator outside a team, no sharing below the Enterprise plan.
    expect(byTestId('asset-panel-size')).toBeNull()
    expect(byTestId('asset-panel-created-by')).toBeNull()
    expect(byTestId('asset-panel-permissions')).toBeNull()
  })

  test("a file's size; the creator in a team; who it is shared with on Enterprise", async () => {
    focused.value = asset(AssetType.file, { size: 2048, createdBy: OWNER })
    category.value = { type: 'team' } as Category
    user.value = { ...SELF, plan: Plan.enterprise }
    await renderTab()
    expect(byTestId('asset-panel-size')?.textContent).toContain('2 KiB')
    expect(byTestId('asset-panel-created-by')?.textContent).toContain('Ada Lovelace')
    const sharedWith = byTestId('asset-panel-permissions')?.textContent ?? ''
    expect(sharedWith).toContain('Ada Lovelace')
    expect(sharedWith).toContain('Me')
  })

  test('the path is copied encoded', async () => {
    focused.value = asset(AssetType.project, { ensoPath: 'enso://Users/me/My Project' })
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    await renderTab()
    byTestId('asset-panel-path')?.querySelector('button')?.click()
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith('enso://Users/me/My%20Project')
  })
})

describe('secrets', () => {
  test('a secret takes a new value, and Cancel resets the form', async () => {
    focused.value = asset(AssetType.secret)
    await renderTab()
    const form = byTestId('upsert-secret-modal')!
    const input = form.querySelector<HTMLInputElement>('input[type="password"]')!
    const user = userEvent.setup()
    await user.type(input, 'hunter2')
    await user.click(
      [...form.querySelectorAll('button')].find((b) => b.textContent?.includes('Cancel'))!,
    )
    expect(input.value).toBe('')
    await user.type(input, 'hunter3')
    await user.click(
      [...form.querySelectorAll('button')].find((b) => b.textContent?.includes('Update'))!,
    )
    await flushPromises()
    expect(backend.updateSecret).toHaveBeenCalledWith(
      SecretId('secret-1'),
      { title: 'Customers', value: 'hunter3' },
      'Customers',
    )
  })

  test('a credential shows its service, state and expiry, and no form', async () => {
    focused.value = asset(AssetType.secret, {
      credentialMetadata: {
        serviceName: 'Google',
        state: 'Ready',
        expirationDate: '2026-12-31T12:00:00Z',
      },
    })
    const { wrapper } = await renderTab()
    expect(wrapper.text()).toContain('Google')
    expect(wrapper.text()).toContain('Ready to be used')
    expect(wrapper.text()).toContain('2026-12-31')
    expect(byTestId('upsert-secret-modal')).toBeNull()
  })
})

describe('datalinks', () => {
  test('the editor shows the datalink; a change offers Update and Reset', async () => {
    focused.value = asset(AssetType.datalink)
    await renderTab()
    expect(backend.getDatalink).toHaveBeenCalledWith(DatalinkId('datalink-1'), 'Customers')
    const editor = byTestId('datalink-stub') as HTMLInputElement
    expect(editor.value).toBe(DATALINK.uri)
    expect(editor.readOnly).toBe(false)
    expect(editor.dataset.dropdownTitle).toBe('Type')
    const buttonNamed = (name: string) =>
      [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === name)
    expect(buttonNamed('Update')).toBeUndefined()

    const user = userEvent.setup()
    await user.clear(editor)
    await user.type(editor, 'https://example.com/other.csv')
    expect(buttonNamed('Update')).toBeDefined()
    await user.click(buttonNamed('Reset')!)
    expect((byTestId('datalink-stub') as HTMLInputElement).value).toBe(DATALINK.uri)
    expect(buttonNamed('Update')).toBeUndefined()

    await user.clear(byTestId('datalink-stub')!)
    await user.type(byTestId('datalink-stub')!, 'https://example.com/other.csv')
    await user.click(buttonNamed('Update')!)
    await flushPromises()
    expect(backend.createDatalink).toHaveBeenCalledWith({
      datalinkId: DatalinkId('datalink-1'),
      name: 'Customers',
      parentDirectoryId: DirectoryId('directory-parent'),
      value: { ...DATALINK, uri: 'https://example.com/other.csv' },
    })
  })

  test('read-only for a user who may not edit it', async () => {
    focused.value = asset(AssetType.datalink, {
      permissions: [{ permission: PermissionAction.own, user: OWNER }],
    })
    await renderTab()
    expect((byTestId('datalink-stub') as HTMLInputElement).readOnly).toBe(true)
  })
})

describe('spotlight', () => {
  test('"Edit" on a secret dims the window around its section, until clicked', async () => {
    focused.value = asset(AssetType.secret)
    spotlightOn.value = 'secret'
    await renderTab()
    // It measures the section on the next frame.
    await new Promise((resolve) => requestAnimationFrame(resolve))
    await flushPromises()
    const overlay = portalRoot.querySelector<HTMLElement>('.bg-primary\\/25')
    expect(overlay).not.toBeNull()
    expect(overlay!.style.clipPath).toContain('path(evenodd')
    // The section is raised above it.
    expect(byTestId('upsert-secret-modal')!.parentElement!.style.zIndex).toBe('3')
    overlay!.click()
    await flushPromises()
    expect(updateContext).toHaveBeenCalledWith({ type: 'drive' }, expect.any(Function))
    expect(spotlightOn.value).toBeUndefined()
    expect(portalRoot.querySelector('.bg-primary\\/25')).toBeNull()
  })

  test('no spotlight without the background element', async () => {
    spotlightRoot.remove()
    focused.value = asset(AssetType.datalink)
    spotlightOn.value = 'datalink'
    await renderTab()
    await new Promise((resolve) => requestAnimationFrame(resolve))
    await flushPromises()
    expect(portalRoot.querySelector('.bg-primary\\/25')).toBeNull()
  })
})
