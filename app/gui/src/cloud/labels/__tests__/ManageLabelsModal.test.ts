/**
 * @file The labels popover (#198): what it lists, checking and unchecking labels on the assets,
 * the search, creating a label (from the "Create Label" form and from a search with no match),
 * deleting one after a confirmation, and Escape, which closes only the innermost popover and does
 * not reach the page (where the dashboard's global binding would close every modal).
 */
import ModalHost from '$/components/ModalHost/ModalHost.vue'
import type { SelectedAssetInfo } from '$/providers/driveStore'
import { useModals } from '$/providers/modals'
import { useText } from '$/providers/text'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import {
  AssetType,
  BackendType,
  COLORS,
  LabelName,
  lChColorToCssColor,
  ProjectId,
  TagId,
  type Backend,
  type Label,
} from 'enso-common/src/services/Backend'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import ManageLabelsModal from '../ManageLabelsModal.vue'

const { getText } = useText()

function label(name: string, color = COLORS[0]): Label {
  return { id: TagId(`tag-${name}`), value: LabelName(name), color }
}

let labels: Label[]
const listTags = vi.fn<Backend['listTags']>()
const createTag = vi.fn<Backend['createTag']>()
const associateTag = vi.fn<Backend['associateTag']>()
const deleteTag = vi.fn<Backend['deleteTag']>()
const backend = {
  type: BackendType.remote,
  listTags,
  createTag,
  associateTag,
  deleteTag,
} as unknown as Backend

const ASSET = {
  id: ProjectId('project-1'),
  type: AssetType.project,
  title: 'labelled',
  parentId: null,
  labels: [LabelName('alpha')],
} as unknown as SelectedAssetInfo

let portalRoot: HTMLElement
let bodyEscapes: number
const onBodyKeyDown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') bodyEscapes += 1
}
beforeEach(() => {
  portalRoot = document.createElement('div')
  portalRoot.id = 'enso-portal-root'
  document.body.appendChild(portalRoot)
  labels = [label('alpha', COLORS[0]), label('beta', COLORS[3])]
  listTags.mockReset().mockImplementation(async () => labels)
  createTag.mockReset().mockImplementation(async ({ value, color }) => {
    const created = { id: TagId(`tag-${value}`), value, color }
    labels = [...labels, created]
    return created
  })
  associateTag.mockReset().mockResolvedValue(undefined)
  deleteTag.mockReset().mockResolvedValue(undefined)
  // The dashboard's global key bindings listen on the body, as `DashboardPage.vue` attaches them.
  bodyEscapes = 0
  document.body.addEventListener('keydown', onBodyKeyDown)
})
afterEach(() => {
  useModals().closeAll()
  document.body.removeEventListener('keydown', onBodyKeyDown)
  portalRoot.remove()
})

async function openPopover(anchor: Element | null = null) {
  await mountWithProviders(ModalHost)
  const onClose = vi.fn()
  const { key } = useModals().open(ManageLabelsModal, { backend, items: [ASSET], anchor })
  await vi.waitFor(() => expect(searchField()).not.toBeNull())
  await flushPromises()
  return { key, onClose }
}

const searchField = () =>
  document.querySelector<HTMLInputElement>(`input[placeholder="${getText('search.placeholder')}"]`)
const buttonNamed = (name: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === name)
const labelButton = (name: string) => buttonNamed(name)
const checkOf = (name: string) => labelButton(name)?.querySelector('svg path')?.getAttribute('d')

describe('ManageLabelsModal', () => {
  test('lists every label as a pill and in the list, checked when the asset has it', async () => {
    await openPopover()
    const pills = document.querySelector(
      `[role="list"][aria-label="${getText('manageLabelsModal.selectedLabels')}"]`,
    )!
    expect(
      [...pills.querySelectorAll('[role="listitem"]')].map((p) => p.textContent?.trim()),
    ).toEqual(['alpha', 'beta'])
    expect(
      (pills.querySelector('[role="listitem"]') as HTMLElement).style.backgroundColor,
    ).not.toBe('')
    expect(checkOf('alpha')).toBe('M4 8.4L6.5 10.9L9.25 8.15L12 5.4')
    expect(checkOf('beta')).toBe('')
    // The search field has the focus, as React's `autoFocus`.
    await vi.waitFor(() => expect(document.activeElement).toBe(searchField()))
  })

  test('checking and unchecking a label sets the asset labels at once', async () => {
    await openPopover()
    const user = userEvent.setup()
    await user.click(labelButton('beta')!)
    await flushPromises()
    expect(associateTag).toHaveBeenLastCalledWith(ASSET.id, ['alpha', 'beta'], 'labelled')
    expect(checkOf('beta')).toBe('M4 8.4L6.5 10.9L9.25 8.15L12 5.4')
    await user.click(labelButton('alpha')!)
    await flushPromises()
    // Computed from the labels the asset had when the popover opened, as in React.
    expect(associateTag).toHaveBeenLastCalledWith(ASSET.id, ['beta'], 'labelled')
  })

  test('the search filters the list, and offers to create a missing label', async () => {
    await openPopover()
    const user = userEvent.setup()
    await user.type(searchField()!, 'BET')
    expect(labelButton('beta')).toBeDefined()
    expect(labelButton('alpha')).toBeUndefined()
    await user.clear(searchField()!)
    await user.type(searchField()!, 'gamma')
    const create = buttonNamed(getText('manageLabelsModal.createLabelWithTitle', 'gamma'))!
    expect(create.getAttribute('type')).toBe('button')
    await user.click(create)
    await flushPromises()
    // The least used colour: `COLORS[1]`, as no label has it.
    expect(createTag).toHaveBeenCalledExactlyOnceWith({
      value: 'gamma',
      color: COLORS[1],
    })
    expect(associateTag).toHaveBeenLastCalledWith(ASSET.id, ['alpha', 'gamma'], 'labelled')
    expect(labelButton('gamma')).toBeDefined()
  })

  test('"Next color" does not change the colour, as in React', async () => {
    await openPopover()
    const user = userEvent.setup()
    await user.type(searchField()!, 'gamma')
    const swatch = document.querySelector<HTMLElement>(
      `button[aria-label="${getText('manageLabelsModal.nextColor')}"]`,
    )!
    const before = swatch.style.backgroundColor
    expect(before).not.toBe('')
    await user.click(swatch)
    expect(swatch.style.backgroundColor).toBe(before)
  })

  test('Enter in the search field resets the form, as React implicit submission did', async () => {
    await openPopover()
    const user = userEvent.setup()
    await user.click(labelButton('beta')!)
    await user.type(searchField()!, 'be{Enter}')
    await flushPromises()
    expect(searchField()!.value).toBe('')
    // Back to what the asset had when the popover opened.
    expect(checkOf('beta')).toBe('')
    expect(createTag).not.toHaveBeenCalled()
  })

  test('"Create Label" creates a label with the chosen colour, and rejects a duplicate', async () => {
    await openPopover()
    const user = userEvent.setup()
    await user.click(buttonNamed(getText('manageLabelsModal.createLabel'))!)
    await flushPromises()
    const form = [...document.querySelectorAll('[role="dialog"]')].at(-1)!
    const name = form.querySelector<HTMLInputElement>('input[type="text"]')!
    await vi.waitFor(() => expect(document.activeElement).toBe(name))
    const radios = form.querySelectorAll<HTMLInputElement>('input[type="radio"]')
    expect(radios).toHaveLength(COLORS.length)
    // The least used colour is chosen at first.
    expect(radios[1]!.checked).toBe(true)
    await user.keyboard('alpha')
    await user.click(form.querySelector<HTMLButtonElement>('button[type="submit"]')!)
    await flushPromises()
    expect(form.textContent).toContain(getText('manageLabelsModal.labelAlreadyExists'))
    expect(createTag).not.toHaveBeenCalled()

    await user.clear(name)
    await user.type(name, 'delta')
    await user.click(radios[5]!)
    expect(radios[5]!.closest('label')!.hasAttribute('data-selected')).toBe(true)
    await user.click(form.querySelector<HTMLButtonElement>('button[type="submit"]')!)
    await flushPromises()
    expect(createTag).toHaveBeenCalledExactlyOnceWith({ value: 'delta', color: COLORS[5] })
    expect(labelButton('delta')).toBeDefined()
  })

  test('the delete button asks first, then deletes the label', async () => {
    await openPopover()
    const user = userEvent.setup()
    const deleteButtons = [
      ...document.querySelectorAll<HTMLButtonElement>(`button[aria-label="${getText('delete')}"]`),
    ]
    await user.click(deleteButtons[1]!)
    await flushPromises()
    const confirm = document.querySelector('[role="alertdialog"]')!
    expect(confirm.textContent).toContain(getText('deleteLabelActionText', 'beta'))
    expect(confirm.textContent).toContain('cannot be undone')
    await user.click(document.querySelector<HTMLElement>('[data-testid="alert-dialog-confirm"]')!)
    await flushPromises()
    expect(deleteTag).toHaveBeenCalledExactlyOnceWith(TagId('tag-beta'), 'beta')
    expect(labelButton('beta')).toBeUndefined()
  })

  test('Escape closes the inner form, then the popover, and never reaches the page', async () => {
    await openPopover()
    const user = userEvent.setup()
    await user.click(buttonNamed(getText('manageLabelsModal.createLabel'))!)
    await flushPromises()
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2)
    await user.keyboard('{Escape}')
    await flushPromises()
    await vi.waitFor(() => expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1))
    expect(useModals().stack.value).toHaveLength(1)
    await user.click(searchField()!)
    await user.keyboard('{Escape}')
    await flushPromises()
    await vi.waitFor(() => expect(useModals().stack.value).toHaveLength(0))
    expect(bodyEscapes).toBe(0)
  })

  test('anchored to its opener, it returns the focus there as it closes', async () => {
    const opener = document.createElement('button')
    opener.textContent = 'edit labels'
    document.body.appendChild(opener)
    opener.focus()
    await openPopover(opener)
    await vi.waitFor(() => expect(document.activeElement).toBe(searchField()))
    await userEvent.setup().keyboard('{Escape}')
    await vi.waitFor(() => expect(useModals().stack.value).toHaveLength(0))
    await vi.waitFor(() => expect(document.activeElement).toBe(opener))
    opener.remove()
  })

  test('the colour dots and pills use the labels colours', async () => {
    await openPopover()
    const dot = labelButton('beta')!.querySelector<HTMLElement>('.rounded-full')!
    const expected = document.createElement('div')
    expected.style.backgroundColor = lChColorToCssColor(COLORS[3])
    expect(dot.style.backgroundColor).toBe(expected.style.backgroundColor)
  })
})
