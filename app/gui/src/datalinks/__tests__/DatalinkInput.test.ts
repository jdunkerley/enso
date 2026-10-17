/* eslint-disable vue/one-component-per-file -- a stub of the file browser and a host holding the value. */
/**
 * @file The datalink editor (#198): what it builds from the datalink schema, choosing a type,
 * optional properties, invalid values and their descriptions, number fields, the secret combo box
 * and the file path with its file browser.
 */
import { useText } from '$/providers/text'
import SCHEMA from '$/utils/datalinkSchema.json' with { type: 'json' }
import { constantValueOfSchema } from '$/utils/jsonSchema'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import type { Backend } from 'enso-common/src/services/Backend'
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { defineComponent, h, shallowRef } from 'vue'
import DatalinkInput from '../DatalinkInput.vue'
import JSONSchemaInput from '../JSONSchemaInput.vue'

const listSecrets = vi.hoisted(() => vi.fn())
vi.mock('$/providers/backends', async () => {
  const { mockBackends } = await import('$/utils/testing/mountWithProviders')
  const backends = mockBackends({ remoteBackend: { listSecrets } as Partial<Backend> })
  return { useBackends: () => backends }
})
vi.mock('$/providers/auth', () => ({
  useAuth: () => ({ session: { user: { name: 'me' } } }),
}))
// The project view's cloud file browser, stubbed: a button accepting a fixed path.
vi.mock('@/components/widgets/FileBrowserWidget.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      props: { choosenPath: String, type: String, writeMode: Boolean, allowOverride: Boolean },
      emits: ['pathAccepted'],
      setup(props, { emit }) {
        return () =>
          h(
            'button',
            {
              'data-testid': 'file-browser',
              'data-path': props.choosenPath,
              onClick: () => emit('pathAccepted', 'enso://Users/me/data.csv'),
            },
            'browse',
          )
      },
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
  portalRoot?.remove()
  portalRoot = document.createElement('div')
  portalRoot.id = 'enso-portal-root'
  document.body.appendChild(portalRoot)
  listSecrets
    .mockReset()
    .mockResolvedValue([{ path: 'enso://Users/me/api-key' }, { path: 'enso://Teams/team/shared' }])
})

/** Mount the editor holding its own value, as a form field would. */
async function mountEditor(initial: unknown = INITIAL, readOnly = false) {
  const value = shallowRef<unknown>(initial)
  const Host = defineComponent({
    setup: () => () =>
      h(DatalinkInput, {
        value: value.value,
        readOnly,
        dropdownTitle: getText('type'),
        onChange: (newValue: unknown) => (value.value = newValue),
      }),
  })
  const { wrapper } = await mountWithProviders(Host)
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
      'Enso File',
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

  test('a secret is chosen from the user secrets, shown with `~` for the user', async () => {
    await mountEditor()
    await chooseType('Postgres Database Connection')
    await chooseType('Enso Secret', 1)
    await vi.waitFor(() => expect(listSecrets).toHaveBeenCalled())
    expect(placeholder(getText('enterSecretPath'))).toHaveLength(1)
  })

  test("an invalid secret shows its schema's description once", async () => {
    await mountWithProviders(JSONSchemaInput, {
      props: {
        defs: {},
        schema: { type: 'string', format: 'enso-secret', description: 'Choose a secret.' },
        path: '#',
        getValidator: () => () => false,
        value: '',
        onChange: () => {},
      },
    })
    await vi.waitFor(() => expect(listSecrets).toHaveBeenCalled())
    expect(element().textContent?.match(/Choose a secret\./g)).toHaveLength(1)
  })

  test('a file path opens the file browser, which sets the path', async () => {
    const { value } = await mountEditor()
    await chooseType('Enso File')
    const input = placeholder(getText('enterText'))[0]!
    expect(element().querySelector('[data-testid="file-browser"]')).toBeNull()
    await userEvent.setup().click(input)
    const browser = element().querySelector<HTMLElement>('[data-testid="file-browser"]')!
    expect(browser).not.toBeNull()
    await userEvent.setup().click(browser)
    expect(value.value).toMatchObject({ path: 'enso://Users/me/data.csv' })
    expect(input.value).toBe('enso://Users/me/data.csv')
  })

  test('read-only: the fields cannot be edited', async () => {
    await mountEditor(INITIAL, true)
    expect(placeholder(getText('enterText'))[0]!.readOnly).toBe(true)
  })
})
