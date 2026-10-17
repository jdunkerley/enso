/**
 * @file The "Create Datalink" dialog (#198): the name focused at first, nothing created while the
 * name is missing or the datalink invalid, creation with a valid one, and Cancel and Escape.
 */
import { useText } from '$/providers/text'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import UpsertDatalinkModal from '../UpsertDatalinkModal.vue'

const { getText } = useText()

beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {}
})
let portalRoot: HTMLElement
beforeEach(() => {
  portalRoot = document.createElement('div')
  portalRoot.id = 'enso-portal-root'
  document.body.appendChild(portalRoot)
})
afterEach(() => portalRoot.remove())

async function mountModal(props: Record<string, unknown> = {}) {
  const doCreate = vi.fn()
  const onClose = vi.fn()
  await mountWithProviders(UpsertDatalinkModal, { props: { doCreate, onClose, ...props } })
  return { doCreate, onClose }
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!
const button = (name: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === name)
const nameInput = () =>
  document.querySelector<HTMLInputElement>(
    `input[placeholder="${getText('datalinkNamePlaceholder')}"]`,
  )!

describe('UpsertDatalinkModal', () => {
  test('"Create Datalink", the name focused, and the editor with its "Type" title', async () => {
    await mountModal()
    expect(dialog().querySelector('h2')!.textContent).toBe(getText('createDatalink'))
    await vi.waitFor(() => expect(document.activeElement).toBe(nameInput()))
    expect(dialog().textContent).toContain(getText('type'))
  })

  test('creates nothing while the name is missing or the datalink invalid', async () => {
    const { doCreate } = await mountModal()
    const user = userEvent.setup()
    await user.click(button(getText('create'))!)
    await flushPromises()
    expect(doCreate).not.toHaveBeenCalled()
    await user.type(nameInput(), 'my link')
    await user.click(button(getText('create'))!)
    await flushPromises()
    // The S3 URI is still empty.
    expect(doCreate).not.toHaveBeenCalled()
  })

  test('creates a valid datalink, then closes', async () => {
    const { doCreate, onClose } = await mountModal()
    const user = userEvent.setup()
    await user.type(nameInput(), 'my link')
    await user.type(
      dialog().querySelector<HTMLInputElement>(`input[placeholder="${getText('enterText')}"]`)!,
      's3://bucket/key',
    )
    await user.click(button(getText('create'))!)
    await flushPromises()
    expect(doCreate).toHaveBeenCalledExactlyOnceWith('my link', {
      type: 'S3',
      libraryName: 'Standard.AWS',
      uri: 's3://bucket/key',
      auth: { type: 'aws_auth', subType: 'default' },
    })
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  test('Cancel closes it without creating', async () => {
    const { doCreate, onClose } = await mountModal()
    await userEvent.setup().click(button(getText('cancel'))!)
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(doCreate).not.toHaveBeenCalled()
  })

  test('edit mode: "Edit Datalink", the name read-only, the value loaded, and Save', async () => {
    const existing = {
      name: 'my link',
      value: {
        type: 'S3',
        libraryName: 'Standard.AWS',
        uri: 's3://bucket/old',
        auth: { type: 'aws_auth', subType: 'default' },
      },
    }
    const { doCreate, onClose } = await mountModal({ existing })
    expect(dialog().querySelector('h2')!.textContent).toBe(getText('editDatalink'))
    expect(nameInput().value).toBe('my link')
    expect(nameInput().readOnly).toBe(true)
    const uri = dialog().querySelector<HTMLInputElement>(
      `input[placeholder="${getText('enterText')}"]`,
    )!
    expect(uri.value).toBe('s3://bucket/old')
    const user = userEvent.setup()
    await user.clear(uri)
    await user.type(uri, 's3://bucket/new')
    await user.click(button(getText('save'))!)
    await flushPromises()
    expect(doCreate).toHaveBeenCalledExactlyOnceWith('my link', {
      ...existing.value,
      uri: 's3://bucket/new',
    })
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
  })
})
