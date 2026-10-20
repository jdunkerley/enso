/**
 * @file The datalink editor (#198): what it builds from the datalink schema, choosing a type,
 * optional properties, invalid values and their descriptions, number fields, secure values (plain
 * text, or a local secret picked or created), and Enso File, which the local IDE cannot offer.
 */
import ModalHost from '$/components/ModalHost/ModalHost.vue'
import { useModals } from '$/providers/modals'
import { useText } from '$/providers/text'
import SCHEMA from '$/utils/datalinkSchema.json' with { type: 'json' }
import { constantValueOfSchema } from '$/utils/jsonSchema'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { defineComponent, h, shallowRef } from 'vue'
import DatalinkInput from '../DatalinkInput.vue'

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
const DEFS: Record<string, object> = SCHEMA.$defs
const INITIAL = constantValueOfSchema(DEFS, SCHEMA.$defs.DataLink, true)[0]

beforeAll(() => {
  // jsdom has no layout: Reka's list scrolls its chosen option into view.
  Element.prototype.scrollIntoView ??= () => {}
})
let portalRoot: HTMLElement
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
  portalRoot?.remove()
  portalRoot = document.createElement('div')
  portalRoot.id = 'enso-portal-root'
  document.body.appendChild(portalRoot)
})

/** Mount the editor holding its own value, as a form field would. */
async function mountEditor(initial: unknown = INITIAL, readOnly = false) {
  const value = shallowRef<unknown>(initial)
  const Host = defineComponent({
    setup: () => () =>
      h('div', [
        h(DatalinkInput, {
          value: value.value,
          readOnly,
          dropdownTitle: getText('type'),
          onChange: (newValue: unknown) => (value.value = newValue),
        }),
        h(ModalHost),
      ]),
  })
  const { wrapper } = await mountWithProviders(Host)
  await flushPromises()
  return { value, wrapper }
}

const element = () => document.body
const placeholder = (text: string) => [
  ...element().querySelectorAll<HTMLInputElement>(`input[placeholder="${text}"]`),
]
const buttonNamed = (name: string) =>
  [...element().querySelectorAll('button')].find((b) => b.textContent?.trim() === name)

async function chooseType(name: string, listIndex = 0) {
  const list = element().querySelectorAll(`[role="listbox"][aria-label="${getText('options')}"]`)[
    listIndex
  ]!
  const option = [...list.querySelectorAll('[role="option"]')].find(
    (o) => o.textContent?.trim() === name,
  )!
  await userEvent.setup().click(option)
  await flushPromises()
}

describe('DatalinkInput', () => {
  test('starts as an S3 datalink: the type list, its title, and its fields', async () => {
    const { value } = await mountEditor()
    expect(value.value).toMatchObject({ type: 'S3', libraryName: 'Standard.AWS' })
    expect(element().textContent).toContain(getText('type'))
    const lists = element().querySelectorAll(`[role="listbox"][aria-label="${getText('options')}"]`)
    expect(
      [...lists[0]!.querySelectorAll('[role="option"]')].map((o) => o.textContent?.trim()),
    ).toEqual([
      'S3',
      'HTTP Fetch',
      'Postgres Database Connection',
      'Snowflake Database Connection',
      'SQL Server Database Connection',
    ])
    // Required properties: their buttons are disabled; the empty URI is invalid, with its rule.
    expect((buttonNamed('URI') as HTMLButtonElement).disabled).toBe(true)
    expect(element().textContent).toContain('Must start with "s3://".')
    expect(placeholder(getText('enterText'))[0]!.className).toContain('border-danger')
  })

  test('typing a valid URI clears the error', async () => {
    const { value } = await mountEditor()
    await userEvent.setup().type(placeholder(getText('enterText'))[0]!, 's3://bucket/key')
    expect(value.value).toMatchObject({ uri: 's3://bucket/key' })
    expect(element().textContent).not.toContain('Must start with "s3://".')
  })

  test('choosing a type sets its constant value', async () => {
    const { value } = await mountEditor()
    await chooseType('Postgres Database Connection')
    expect(value.value).toMatchObject({
      type: 'Postgres_Connection',
      libraryName: 'Standard.Database',
      port: 5432,
    })
    const port = element().querySelector<HTMLInputElement>('input[type="number"]')!
    expect(port.value).toBe('5432')
    await userEvent.setup().clear(port)
    await userEvent.setup().type(port, '6543')
    expect(value.value).toMatchObject({ port: 6543 })
  })

  test('an optional property is added and removed by its button', async () => {
    const { value } = await mountEditor()
    await chooseType('Postgres Database Connection')
    expect(value.value).not.toHaveProperty('schema')
    await userEvent.setup().click(buttonNamed('Schema')!)
    expect(value.value).toHaveProperty('schema', '')
    await userEvent.setup().click(buttonNamed('Schema')!)
    expect(value.value).not.toHaveProperty('schema')
  })

  test('a secure value offers Plain text and Secret', async () => {
    await mountEditor()
    await chooseType('Postgres Database Connection')
    const options = [...element().querySelectorAll('[role="option"]')].map((o) =>
      o.textContent?.trim(),
    )
    expect(options).toContain('Plain text')
    expect(options).toContain('Secret')
  })

  /** The index of the (Postgres) password's type list. */
  const PASSWORD_LIST = 2

  /** Open a Postgres datalink, and choose Secret for its password. */
  async function chooseSecretPassword() {
    const editor = await mountEditor()
    await chooseType('Postgres Database Connection')
    await chooseType('Secret', PASSWORD_LIST)
    return editor
  }

  const pickerList = () => element().querySelector('[role="listbox"][aria-label="Secret"]')!
  const pickerOption = (name: string) =>
    [...pickerList().querySelectorAll('[role="option"]')].find(
      (o) => o.textContent?.trim() === name,
    )
  const isDisabled = (el: Element) =>
    el.closest('[data-disabled]') ?? el.querySelector('[data-disabled]')

  test('choosing Secret shows the picker; picking a secret sets its secret:// path', async () => {
    const { value } = await chooseSecretPassword()
    expect(value.value).toMatchObject({ credentials: { password: { type: 'secret' } } })
    await userEvent.setup().click(pickerOption('db')!)
    await flushPromises()
    expect(value.value).toMatchObject({
      credentials: { password: { type: 'secret', secretPath: 'secret://db' } },
    })
  })

  test('New secret... creates through the backend, then selects it', async () => {
    const { value } = await chooseSecretPassword()
    const user = userEvent.setup()
    await user.click(pickerOption(getText('datalinkNewSecret'))!)
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
    await vi.waitFor(() =>
      expect(value.value).toMatchObject({
        credentials: { password: { type: 'secret', secretPath: 'secret://fresh' } },
      }),
    )
  })

  test('read-only: the picker is disabled', async () => {
    await mountEditor(WITH_LOCAL_SECRET, true)
    expect(isDisabled(pickerList())).not.toBeNull()
  })

  test('with no local backend, the picker is disabled and offers no secrets', async () => {
    fake.hasBackend = false
    await mountEditor(WITH_LOCAL_SECRET)
    expect(isDisabled(pickerList())).not.toBeNull()
    expect(fake.listSecrets).not.toHaveBeenCalled()
    expect(pickerOption(getText('datalinkNewSecret'))).toBeUndefined()
  })

  test('when the secrets cannot be listed, the picker says so', async () => {
    fake.listSecrets.mockImplementation(() => Promise.reject(new Error('locked')))
    await chooseSecretPassword()
    await vi.waitFor(() =>
      expect(element().querySelector('[data-testid="secret-picker-error"]')?.textContent).toContain(
        getText('secretsLoadFailed', 'locked'),
      ),
    )
  })

  const WITH_SECRET = {
    type: 'Postgres_Connection',
    libraryName: 'Standard.Database',
    host: 'db',
    port: 5432,
    // eslint-disable-next-line camelcase
    database_name: 'sales',
    credentials: {
      username: 'me',
      password: { type: 'secret', secretPath: 'enso://Users/me/pw' },
    },
  }

  const WITH_LOCAL_SECRET = {
    ...WITH_SECRET,
    credentials: { username: 'me', password: { type: 'secret', secretPath: 'secret://db' } },
  }

  test('an existing secret reference is kept, shown in the picker, and can be replaced by text', async () => {
    const { value } = await mountEditor(WITH_SECRET)
    expect(pickerList().textContent).toContain('enso://Users/me/pw')
    expect(value.value).toEqual(WITH_SECRET)
    const passwordList = element().querySelectorAll(
      `[role="listbox"][aria-label="${getText('options')}"]`,
    )[2]!
    await userEvent
      .setup()
      .click(
        [...passwordList.querySelectorAll('[role="option"]')].find(
          (o) => o.textContent?.trim() === 'Plain text',
        )!,
      )
    expect(value.value).toMatchObject({ credentials: { username: 'me', password: '' } })
    expect(
      [...passwordList.querySelectorAll('[role="option"]')].map((o) => o.textContent?.trim()),
    ).toEqual(['Plain text', 'Secret'])
  })

  test('an existing Enso File datalink opens, its path as plain text', async () => {
    const link = {
      type: 'Enso_File',
      libraryName: 'Standard.Base',
      path: 'enso://Users/me/a.csv',
    }
    await mountEditor(link)
    expect(
      [...element().querySelectorAll<HTMLInputElement>('input')].some((i) => i.value === link.path),
    ).toBe(true)
  })

  test('read-only: the fields cannot be edited', async () => {
    await mountEditor(INITIAL, true)
    expect(placeholder(getText('enterText'))[0]!.readOnly).toBe(true)
  })
})
