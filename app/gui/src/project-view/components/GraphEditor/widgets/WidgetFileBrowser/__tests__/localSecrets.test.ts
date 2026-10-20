/**
 * @file The graph editor's local secret items: a `Secret_Browse` argument's dropdown lists the
 * local secrets and **New secret…**; choosing one sets the argument to `Enso_Secret.get` of its
 * `secret://` path.
 */
import ModalHost from '$/components/ModalHost/ModalHost.vue'
import { useModals } from '$/providers/modals'
import type { GraphDb } from '$/providers/openedProjects/graph/graphDatabase'
import { Score, WidgetInput, type WidgetProps } from '$/providers/openedProjects/widgetRegistry'
import { useText } from '$/providers/text'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import {
  useBrowserTypeInfo,
  useSetPath,
  withBrowserItems,
  type BrowserItem,
} from '@/components/GraphEditor/widgets/WidgetFileBrowser/browsableTypes'
import { widgetDefinition as selectionWidget } from '@/components/GraphEditor/widgets/WidgetSelection.vue'
import type { CustomDropdownItem } from '@/components/GraphEditor/widgets/WidgetSelection/tags'
import { Ast } from '@/util/ast'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { computed, defineComponent, h, type ComputedRef } from 'vue'
import { useLocalSecretItems } from '../localSecrets'

const fake = vi.hoisted(() => ({
  hasBackend: true,
  names: [] as string[],
  listSecrets: vi.fn(),
  createSecret: vi.fn(),
}))

vi.mock('$/providers/backends', async () => {
  const { mockBackends } = await import('$/utils/testing/mountWithProviders')
  return {
    useBackends: () =>
      mockBackends({
        localBackend:
          fake.hasBackend ?
            { listSecrets: fake.listSecrets, createSecret: fake.createSecret }
          : null,
      }),
  }
})

const { getText } = useText()

beforeEach(() => {
  fake.hasBackend = true
  fake.names = ['db', 'warehouse']
  fake.listSecrets.mockReset()
  fake.createSecret.mockReset()
  fake.listSecrets.mockImplementation(() =>
    Promise.resolve(
      fake.names.map((name) => ({ name, id: `local:${name}`, path: `secret://${name}` })),
    ),
  )
  fake.createSecret.mockImplementation(({ name }: { name: string }) => {
    fake.names.push(name)
    return Promise.resolve(`local:${name}`)
  })
  useModals().closeAll()
  document.getElementById('enso-portal-root')?.remove()
  const portalRoot = document.createElement('div')
  portalRoot.id = 'enso-portal-root'
  document.body.appendChild(portalRoot)
})

const FILE_BROWSE = {
  kind: 'File_Browse',
  // eslint-disable-next-line camelcase
  existing_only: true,
  // eslint-disable-next-line camelcase
  file_types: [],
} as const

/**
 * Mount the items for an argument of the given dynamic config, the way `WidgetFileBrowser` does.
 * `setPath` makes the widget's edit, whose new argument code is recorded in `codes`.
 */
async function mountItems(kind: 'Secret_Browse' | 'File_Browse') {
  const codes: string[] = []
  const makeSetPathUpdate = useSetPath({
    currentPath: undefined,
    preferRawPath: false,
    portId: 'MOCK-PORT-ID' as Ast.AstId,
    addMissingConstructorImports: () => true,
  })
  function setPath(type: 'file' | 'secret', path: string) {
    const update = makeSetPathUpdate(type, path, Ast.MutableModule.Transient())
    codes.push((update.portUpdate as { value: Ast.Expression }).value.code())
  }
  let items!: ComputedRef<CustomDropdownItem[]>
  const Host = defineComponent({
    setup() {
      const typeInfo = useBrowserTypeInfo({
        reprType: undefined,
        dynamicConfig: kind === 'Secret_Browse' ? { kind } : FILE_BROWSE,
      })
      const dialogKind = computed((): BrowserItem =>
        typeInfo.value.types.secret ? 'secret' : 'file',
      )
      items = useLocalSecretItems({ dialogKind, setPath })
      return () => h(ModalHost)
    },
  })
  await mountWithProviders(Host)
  await flushPromises()
  return { items, codes }
}

const labels = (items: readonly CustomDropdownItem[]) => items.map((item) => item.label)
const click = (items: readonly CustomDropdownItem[], label: string) =>
  items.find((item) => item.label === label)!.onClick({ setActivity: () => {}, close: () => {} })

describe('useLocalSecretItems', () => {
  test("a Secret_Browse argument's dropdown lists the local secrets and New secret…", async () => {
    const { items } = await mountItems('Secret_Browse')
    expect(labels(items.value)).toEqual(['db', 'warehouse', getText('datalinkNewSecret')])
    expect(items.value.at(-1)!.icon).toBe('key_add')
    // The items give the argument a dropdown, which a secret-only argument had none of before.
    const input = withBrowserItems(WidgetInput.FromAst(Ast.parseExpression('x')!), items.value)
    expect(selectionWidget.score({ input } as WidgetProps<WidgetInput>, {} as GraphDb)).toBe(
      Score.Perfect,
    )
  })

  test("choosing db sets the argument to Enso_Secret.get 'secret://db'", async () => {
    const { items, codes } = await mountItems('Secret_Browse')
    click(items.value, 'db')
    expect(codes).toEqual(["(Enso_Secret.get 'secret://db')"])
  })

  test('New secret… creates through the backend, then sets its path', async () => {
    const { items, codes } = await mountItems('Secret_Browse')
    click(items.value, getText('datalinkNewSecret'))
    const user = userEvent.setup()
    const dialogInput = (text: string) =>
      document.querySelector<HTMLInputElement>(`[role="dialog"] input[placeholder="${text}"]`)
    await vi.waitFor(() => expect(dialogInput(getText('secretNamePlaceholder'))).not.toBeNull())
    await user.type(dialogInput(getText('secretNamePlaceholder'))!, 'fresh')
    await user.type(dialogInput(getText('secretValuePlaceholder'))!, 'v')
    await user.click(
      [...document.querySelectorAll<HTMLElement>('[role="dialog"] button')].find(
        (b) => b.textContent.trim() === getText('create'),
      )!,
    )
    await flushPromises()
    expect(fake.createSecret).toHaveBeenCalledExactlyOnceWith({
      name: 'fresh',
      value: 'v',
      parentDirectoryId: null,
    })
    await vi.waitFor(() => expect(codes).toEqual(["(Enso_Secret.get 'secret://fresh')"]))
    await vi.waitFor(() => expect(labels(items.value)).toContain('fresh'))
  })

  test('a file argument shows no secret items', async () => {
    const { items } = await mountItems('File_Browse')
    expect(items.value).toEqual([])
    expect(fake.listSecrets).not.toHaveBeenCalled()
  })

  test('with no local backend (the browser build), there are no secret items', async () => {
    fake.hasBackend = false
    const { items } = await mountItems('Secret_Browse')
    expect(items.value).toEqual([])
  })
})
