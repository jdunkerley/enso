/**
 * @file Keyboard, focus and ARIA behaviour of the Vue `Dialog`, `Popover` and `AlertDialog`: what
 * react-aria's overlays give the React ones, and what a port must not lose.
 */
import {
  byTestId,
  mountWithProviders,
  usePrimitiveTestEnvironment,
} from '$/components/__tests__/mountWithProviders'
import AlertDialog from '$/components/AlertDialog/AlertDialog.vue'
import Button from '$/components/Button/Button.vue'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { describe, expect, test, vi } from 'vitest'
import { h, ref } from 'vue'
import Dialog from '../Dialog.vue'
import DialogClose from '../DialogClose.vue'
import Popover from '../Popover.vue'

const env = usePrimitiveTestEnvironment()

const role = (name: string) => document.querySelector<HTMLElement>(`[role="${name}"]`)

function mountDialog(props: Record<string, unknown> = {}) {
  const onDismiss = vi.fn()
  const onOuterKeydown = vi.fn()
  mountWithProviders(() =>
    h('div', { onKeydown: onOuterKeydown }, [
      h(
        Dialog,
        { title: 'Rename project', testId: 'dialog', onDismiss, ...props },
        {
          trigger: () => h(Button, { testId: 'trigger' }, () => 'Rename'),
          default: ({ close }: { close: () => void }) => [
            h('input', { 'data-testid': 'name' }),
            h(Button, { testId: 'save', onPress: close }, () => 'Save'),
            h(DialogClose, { testId: 'cancel', variant: 'ghost' }, () => 'Cancel'),
          ],
        },
      ),
      h('button', { 'data-testid': 'outside' }, 'Outside'),
    ]),
  )
  return { onDismiss, onOuterKeydown }
}

async function openWithKeyboard() {
  const user = userEvent.setup()
  byTestId('trigger')!.focus()
  await user.keyboard('{Enter}')
  await flushPromises()
  return user
}

describe('Dialog', () => {
  test('opens from its trigger as a labelled dialog in the portal root, with focus inside', async () => {
    mountDialog()
    expect(role('dialog')).toBeNull()
    await openWithKeyboard()

    const dialog = role('dialog')!
    expect(dialog).toBe(byTestId('dialog'))
    expect(env.portalRoot.contains(dialog)).toBe(true)
    const titleId = dialog.getAttribute('aria-labelledby')!
    expect(document.getElementById(titleId)?.textContent?.trim()).toBe('Rename project')
    expect(document.getElementById(titleId)?.tagName).toBe('H2')
    expect(byTestId('trigger')!.getAttribute('aria-expanded')).toBe('true')
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  test('traps focus: Tab cycles within the dialog', async () => {
    mountDialog()
    const user = await openWithKeyboard()
    const dialog = role('dialog')!
    for (let i = 0; i < 6; i++) {
      await user.tab()
      expect(dialog.contains(document.activeElement)).toBe(true)
    }
  })

  test('Escape closes it, reports the dismissal and returns focus to the trigger', async () => {
    const { onDismiss } = mountDialog()
    const user = await openWithKeyboard()
    await user.keyboard('{Escape}')
    await flushPromises()
    expect(role('dialog')).toBeNull()
    expect(onDismiss).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(byTestId('trigger'))
  })

  test('isKeyboardDismissDisabled keeps it open on Escape', async () => {
    mountDialog({ isKeyboardDismissDisabled: true })
    const user = await openWithKeyboard()
    await user.keyboard('{Escape}')
    await flushPromises()
    expect(role('dialog')).not.toBeNull()
  })

  test('the close button, DialogClose and the slot close function all close it', async () => {
    const { onDismiss } = mountDialog()
    const user = await openWithKeyboard()
    await user.click(role('dialog')!.querySelector<HTMLElement>('[aria-label="Close"]')!)
    await flushPromises()
    expect(role('dialog')).toBeNull()

    await openWithKeyboard()
    await user.click(byTestId('cancel')!)
    await flushPromises()
    expect(role('dialog')).toBeNull()

    await openWithKeyboard()
    await user.click(byTestId('save')!)
    await flushPromises()
    expect(role('dialog')).toBeNull()
    expect(onDismiss).toHaveBeenCalledTimes(3)
  })

  test('an outside click closes it, unless it is not dismissable', async () => {
    mountDialog()
    const user = await openWithKeyboard()
    await user.click(byTestId('modal-dialog')!)
    await flushPromises()
    expect(role('dialog')).toBeNull()
  })

  test('isDismissable: false ignores outside clicks and blurs the background', async () => {
    mountDialog({ isDismissable: false })
    const user = await openWithKeyboard()
    await user.click(byTestId('modal-dialog')!)
    await flushPromises()
    expect(role('dialog')).not.toBeNull()
    expect(byTestId('modal-dialog')!.parentElement!.classList).toContain('backdrop-blur-md')
  })

  test('keys other than Escape do not propagate out of it', async () => {
    const { onOuterKeydown } = mountDialog()
    const user = await openWithKeyboard()
    // The Enter that opened it was pressed outside.
    onOuterKeydown.mockClear()
    byTestId('name')!.focus()
    await user.keyboard('a')
    expect(onOuterKeydown).not.toHaveBeenCalled()
  })

  test('is styled by the shared DIALOG_STYLES', async () => {
    mountDialog({ size: 'large' })
    await openWithKeyboard()
    const classes = role('dialog')!.classList
    expect(classes).toContain('max-w-lg')
    expect(classes).toContain('rounded-3xl')
    expect(classes).toContain('backdrop-blur-md')
  })

  test('nested dialogs close one at a time, the innermost first', async () => {
    mountWithProviders(() =>
      h(
        Dialog,
        { title: 'Outer', testId: 'outer' },
        {
          trigger: () => h(Button, { testId: 'trigger' }, () => 'Open'),
          default: () =>
            h(
              Dialog,
              { title: 'Inner', testId: 'inner' },
              { trigger: () => h(Button, { testId: 'inner-trigger' }, () => 'More') },
            ),
        },
      ),
    )
    const user = await openWithKeyboard()
    byTestId('inner-trigger')!.focus()
    await user.keyboard('{Enter}')
    await flushPromises()
    expect(byTestId('inner')).not.toBeNull()

    await user.keyboard('{Escape}')
    await flushPromises()
    expect(byTestId('inner')).toBeNull()
    expect(byTestId('outer')).not.toBeNull()
    expect(document.activeElement).toBe(byTestId('inner-trigger'))

    await user.keyboard('{Escape}')
    await flushPromises()
    expect(byTestId('outer')).toBeNull()
  })

  test('can be controlled with v-model:open and no trigger', async () => {
    const open = ref(true)
    mountWithProviders(() =>
      h(Dialog, {
        title: 'Controlled',
        open: open.value,
        'onUpdate:open': (value: boolean) => (open.value = value),
      }),
    )
    await flushPromises()
    expect(role('dialog')).not.toBeNull()
    await userEvent.setup().keyboard('{Escape}')
    await flushPromises()
    expect(open.value).toBe(false)
    expect(role('dialog')).toBeNull()
  })

  test('without a title, an aria-label names the dialog element itself', async () => {
    mountWithProviders(() =>
      h(Dialog, { open: true, 'aria-label': 'Logging out', hideCloseButton: true }, () =>
        h('p', 'Content'),
      ),
    )
    await flushPromises()
    const dialog = role('dialog')!
    expect(dialog.getAttribute('aria-label')).toBe('Logging out')
    expect(document.querySelectorAll('[aria-label="Logging out"]')).toHaveLength(1)
  })
})

describe('Popover', () => {
  function mountPopover(props: Record<string, unknown> = {}) {
    const onClose = vi.fn()
    mountWithProviders(() => [
      h(
        Popover,
        {
          testId: 'popover',
          'aria-label': 'Filters',
          placement: 'bottom-start',
          onClose,
          ...props,
        },
        {
          trigger: () => h(Button, { testId: 'trigger' }, () => 'Filter'),
          default: ({ close }: { close: () => void }) => [
            h(Button, { testId: 'first' }, () => 'First'),
            h(Button, { testId: 'done', onPress: close }, () => 'Done'),
          ],
        },
      ),
      h('button', { 'data-testid': 'outside' }, 'Outside'),
    ])
    return { onClose }
  }

  test('opens as a labelled dialog next to its trigger, focusing its content', async () => {
    mountPopover()
    await openWithKeyboard()
    const popover = byTestId('popover')!
    expect(popover.getAttribute('role')).toBe('dialog')
    expect(popover.getAttribute('aria-label')).toBe('Filters')
    expect(popover.getAttribute('data-side')).toBe('bottom')
    expect(popover.getAttribute('data-align')).toBe('start')
    expect(env.portalRoot.contains(popover)).toBe(true)
    expect(popover.contains(document.activeElement)).toBe(true)
    // `POPOVER_STYLES` defaults: `size: 'small'`, `rounded: 'xxlarge'`.
    expect(popover.classList).toContain('max-w-sm')
    expect(popover.classList).toContain('rounded-2xl')
  })

  test('Escape closes it and returns focus to the trigger', async () => {
    const { onClose } = mountPopover()
    const user = await openWithKeyboard()
    await user.keyboard('{Escape}')
    await flushPromises()
    expect(byTestId('popover')).toBeNull()
    expect(onClose).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(byTestId('trigger'))
  })

  // A modal popover makes the rest of the page `pointer-events: none`, as react-aria's underlay
  // blocks it; the click still reaches the document, which is what dismisses it.
  const outsideClicker = () => userEvent.setup({ pointerEventsCheck: 0 })

  test('an outside click closes it', async () => {
    mountPopover()
    await openWithKeyboard()
    await outsideClicker().click(byTestId('outside')!)
    await flushPromises()
    expect(byTestId('popover')).toBeNull()
  })

  test('isDismissable: false keeps it open on an outside click', async () => {
    mountPopover({ isDismissable: false })
    await openWithKeyboard()
    await outsideClicker().click(byTestId('outside')!)
    await flushPromises()
    expect(byTestId('popover')).not.toBeNull()
  })

  test('isNonModal leaves the rest of the page interactive', async () => {
    mountPopover({ isNonModal: true })
    const user = await openWithKeyboard()
    expect(getComputedStyle(document.body).pointerEvents).not.toBe('none')
    await user.click(byTestId('outside')!)
    await flushPromises()
    expect(byTestId('popover')).toBeNull()
  })

  test('the slot close function closes it', async () => {
    const { onClose } = mountPopover()
    const user = await openWithKeyboard()
    await user.click(byTestId('done')!)
    await flushPromises()
    expect(byTestId('popover')).toBeNull()
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('AlertDialog', () => {
  function mountAlert(props: Record<string, unknown> = {}) {
    mountWithProviders(() =>
      h(
        AlertDialog,
        { title: 'Delete project?', message: 'This cannot be undone.', testId: 'alert', ...props },
        { trigger: () => h(Button, { testId: 'trigger' }, () => 'Delete') },
      ),
    )
  }

  test('is an alertdialog, labelled and described, with focus on the confirm button', async () => {
    mountAlert({ isDestructive: true })
    await openWithKeyboard()
    const alert = role('alertdialog')!
    expect(alert).toBe(byTestId('alert'))
    const titleId = alert.getAttribute('aria-labelledby')!
    expect(document.getElementById(titleId)?.textContent?.trim()).toBe('Delete project?')
    const descriptionId = alert.getAttribute('aria-describedby')!
    expect(document.getElementById(descriptionId)?.textContent?.trim()).toBe(
      'This cannot be undone.',
    )
    expect(document.activeElement).toBe(byTestId('alert-dialog-confirm'))
    expect(byTestId('alert-dialog-confirm')!.textContent?.trim()).toBe('Confirm')
    expect(byTestId('alert-dialog-cancel')!.textContent?.trim()).toBe('Cancel')
    // `isDestructive` styles the confirm button as a delete.
    expect(byTestId('alert-dialog-confirm')!.classList).toContain('bg-danger/80')
  })

  test('Escape and outside clicks do not dismiss it', async () => {
    mountAlert()
    const user = await openWithKeyboard()
    await user.keyboard('{Escape}')
    await user.click(byTestId('modal-dialog')!)
    await flushPromises()
    expect(role('alertdialog')).not.toBeNull()
  })

  test('confirm waits for onConfirm, showing it as loading, then closes', async () => {
    let resolve!: () => void
    const onConfirm = vi.fn(() => new Promise<void>((r) => (resolve = r)))
    mountAlert({ onConfirm })
    const user = await openWithKeyboard()
    await user.keyboard('{Enter}')
    expect(onConfirm).toHaveBeenCalledOnce()
    expect(byTestId('alert-dialog-confirm')!.getAttribute('aria-busy')).toBe('true')
    expect(byTestId('alert-dialog-cancel')!.hasAttribute('disabled')).toBe(true)
    resolve()
    await flushPromises()
    expect(role('alertdialog')).toBeNull()
  })

  test('cancel calls onCancel and closes', async () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    mountAlert({ onCancel, onConfirm, cancel: 'Keep it' })
    const user = await openWithKeyboard()
    expect(byTestId('alert-dialog-cancel')!.textContent?.trim()).toBe('Keep it')
    await user.click(byTestId('alert-dialog-cancel')!)
    await flushPromises()
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()
    expect(role('alertdialog')).toBeNull()
  })
})

describe('`closed`', () => {
  test('a Dialog emits it once it has closed and left the page, not before', async () => {
    const open = ref(true)
    const onClosed = vi.fn()
    mountWithProviders(() =>
      h(
        Dialog,
        {
          title: 'Settings',
          open: open.value,
          'onUpdate:open': (value: boolean) => (open.value = value),
          onClosed,
        },
        () => 'Content',
      ),
    )
    await flushPromises()
    expect(role('dialog')).not.toBeNull()
    expect(onClosed).not.toHaveBeenCalled()
    open.value = false
    await flushPromises()
    expect(role('dialog')).toBeNull()
    expect(onClosed).toHaveBeenCalledOnce()
  })

  test('an AlertDialog emits it once answered and gone', async () => {
    const onClosed = vi.fn()
    mountWithProviders(() =>
      h(AlertDialog, { title: 'Delete?', message: 'Sure?', open: true, onClosed }),
    )
    await flushPromises()
    expect(onClosed).not.toHaveBeenCalled()
    await userEvent.setup().click(byTestId('alert-dialog-confirm')!)
    await flushPromises()
    expect(role('alertdialog')).toBeNull()
    expect(onClosed).toHaveBeenCalledOnce()
  })
})

describe('focus without a trigger (as react-aria)', () => {
  function mountControlled(props: Record<string, unknown> = {}) {
    const open = ref(false)
    mountWithProviders(() => [
      h('div', { id: 'menu-popup' }, [h('button', { 'data-testid': 'item' }, 'About')]),
      h('button', { 'data-testid': 'menu-trigger', 'aria-controls': 'menu-popup' }, 'Menu'),
      h(
        Dialog,
        {
          title: 'About',
          testId: 'dialog',
          open: open.value,
          'onUpdate:open': (value: boolean) => (open.value = value),
          ...props,
        },
        () => h('button', { 'data-testid': 'inside' }, 'Inside'),
      ),
    ])
    return open
  }

  test('it focuses itself on opening, and returns focus to its opener on closing', async () => {
    const open = mountControlled()
    byTestId('item')!.focus()
    open.value = true
    await flushPromises()
    expect(document.activeElement).toBe(byTestId('dialog'))
    open.value = false
    await vi.waitFor(() => expect(document.activeElement).toBe(byTestId('item')))
  })

  test('when the opener has gone, focus returns to the trigger of the menu it was in', async () => {
    const open = mountControlled()
    byTestId('item')!.focus()
    open.value = true
    await flushPromises()
    byTestId('item')!.remove()
    open.value = false
    await vi.waitFor(() => expect(document.activeElement).toBe(byTestId('menu-trigger')))
  })

  test('a menu in the portal root whose trigger names another id: its one open trigger', async () => {
    const open = ref(false)
    const trigger = document.createElement('button')
    trigger.setAttribute('aria-controls', 'not-rendered')
    trigger.setAttribute('aria-expanded', 'true')
    trigger.dataset.testid = 'user-button'
    document.body.appendChild(trigger)
    const menu = document.createElement('div')
    menu.innerHTML = '<button data-testid="portal-item">About</button>'
    env.portalRoot.appendChild(menu)
    mountWithProviders(() =>
      h(Dialog, {
        title: 'About',
        open: open.value,
        'onUpdate:open': (value: boolean) => (open.value = value),
      }),
    )
    byTestId('portal-item')!.focus()
    open.value = true
    await flushPromises()
    menu.remove()
    trigger.setAttribute('aria-expanded', 'false')
    open.value = false
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger))
    trigger.remove()
  })

  test('an AlertDialog returns focus the same way', async () => {
    const open = ref(false)
    mountWithProviders(() => [
      h('button', { 'data-testid': 'opener' }, 'Delete'),
      h(AlertDialog, {
        title: 'Delete?',
        open: open.value,
        'onUpdate:open': (value: boolean) => (open.value = value),
      }),
    ])
    byTestId('opener')!.focus()
    open.value = true
    await flushPromises()
    expect(document.activeElement).toBe(byTestId('alert-dialog-confirm'))
    await userEvent.setup().click(byTestId('alert-dialog-cancel')!)
    await vi.waitFor(() => expect(document.activeElement).toBe(byTestId('opener')))
  })
})
