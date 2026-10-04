/**
 * @file Side-by-side check (#78): each React primitive and its Vue port, rendered with the same
 * props, produce the same classes, and so, with the same stylesheet, the same look.
 *
 * Where the Vue port differs on purpose, the test says how: react-aria render-state classes
 * (`isFocused`) that a Vue component applies unconditionally because they are scoped by
 * `focus-visible:` anyway, and enter/exit motion that Reka keys on `data-state`/`data-side`
 * instead of react-aria's `isEntering`/`placement-*`.
 *
 * It lives in the dashboard because it imports the React components (`#/`), which shared code
 * may not.
 */
import { Alert } from '#/components/Alert'
import { Badge } from '#/components/Badge'
import { Button } from '#/components/Button'
import { Dialog, DialogStackProvider } from '#/components/Dialog'
import { Loader } from '#/components/Loader'
import { ProfilePicture } from '#/components/ProfilePicture'
import { Result } from '#/components/Result'
import { Text } from '#/components/Text'
import AlertVue from '$/components/Alert/Alert.vue'
import BadgeVue from '$/components/Badge/Badge.vue'
import ButtonVue from '$/components/Button/Button.vue'
import DialogVue from '$/components/Dialog/Dialog.vue'
import { DIALOG_MOTION } from '$/components/Dialog/variants'
import ProfilePictureVue from '$/components/ProfilePicture/ProfilePicture.vue'
import ResultVue from '$/components/Result/Result.vue'
import LoaderVue from '$/components/Spinner/Loader.vue'
import TextVue from '$/components/Text/Text.vue'
import { TextContext } from '$/providers/react'
import { useText } from '$/providers/text'
import { act, render } from '@testing-library/react'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, test } from 'vitest'
import { defineComponent, h, type VNodeChild } from 'vue'

enableAutoUnmount(afterEach)

function mountVue(renderVue: () => VNodeChild) {
  mount(defineComponent({ setup: () => renderVue }), { attachTo: document.body })
}

function byTestId(id: string) {
  const element = document.querySelector<HTMLElement>(`[data-testid="${id}"]`)
  if (element == null) throw new Error(`No element with test id ${id}`)
  return element
}
/**
 * An element's tree as tags, classes and text: what a rendering looks like with the same
 * stylesheet. Other attributes (ids, ARIA, test ids) are left out.
 */
function shape(element: Element): unknown {
  return {
    tag: element.tagName,
    class: [...classSet(element)].sort(),
    children: [...element.childNodes].flatMap((node) =>
      node instanceof Element ? [shape(node)]
      : node.nodeType === Node.TEXT_NODE && node.textContent?.trim() ? [node.textContent.trim()]
      : [],
    ),
  }
}

const classSet = (element: Element | null | undefined) =>
  new Set(
    element
      ?.getAttribute('class')
      ?.split(/\s+/)
      .filter((c) => c !== '') ?? [],
  )

describe('the Vue ports render the same classes as the React primitives', () => {
  test('Button', () => {
    const props = { variant: 'outline', size: 'small', rounded: 'large' } as const
    render(
      <Button {...props} testId="react" icon="add">
        Save
      </Button>,
    )
    mountVue(() => h(ButtonVue, { ...props, testId: 'vue', icon: 'add' }, () => 'Save'))

    // React passes react-aria's `isFocused` render state; the classes it adds are all
    // `focus:`/`focus-visible:`-scoped, so the Vue button applies them always. Compare focused.
    act(() => byTestId('react').focus())
    const react = byTestId('react')
    byTestId('vue').focus()
    const vue = byTestId('vue')
    expect(classSet(vue)).toEqual(classSet(react))
    // Wrapper, content box and icon.
    const [reactWrapper, vueWrapper] = [react.firstElementChild, vue.firstElementChild]
    expect(classSet(vueWrapper)).toEqual(classSet(reactWrapper))
    expect(classSet(vueWrapper?.firstElementChild)).toEqual(
      classSet(reactWrapper?.firstElementChild),
    )
    expect(classSet(vue.querySelector('svg'))).toEqual(classSet(react.querySelector('svg')))
  })

  test('Text', () => {
    const props = { variant: 'subtitle', color: 'muted', weight: 'semibold', nowrap: true } as const
    render(
      <Text {...props} testId="react" truncate="1">
        Hello
      </Text>,
    )
    mountVue(() => h(TextVue, { ...props, testId: 'vue', truncate: '1' }, () => 'Hello'))
    expect(byTestId('vue').tagName).toBe(byTestId('react').tagName)
    expect(classSet(byTestId('vue'))).toEqual(classSet(byTestId('react')))
  })

  test('Badge and Alert', () => {
    render(
      <>
        <Badge color="success" className="react-badge">
          New
        </Badge>
        <Alert variant="warning" size="small" className="react-alert">
          Careful
        </Alert>
      </>,
    )
    mountVue(() => [
      h(BadgeVue, { color: 'success', class: 'vue-badge' }, () => 'New'),
      h(AlertVue, { variant: 'warning', size: 'small', class: 'vue-alert' }, () => 'Careful'),
    ])
    const same = (react: string, vue: string) => {
      const [r, v] = [document.querySelector(react), document.querySelector(vue)]
      const strip = (set: Set<string>, name: string) => (set.delete(name), set)
      expect(strip(classSet(v), vue.slice(1))).toEqual(strip(classSet(r), react.slice(1)))
      expect(classSet(v?.lastElementChild)).toEqual(classSet(r?.lastElementChild))
    }
    same('.react-badge', '.vue-badge')
    same('.react-alert', '.vue-alert')
  })

  test('Dialog', async () => {
    const props = { title: 'Settings', size: 'large', padding: 'large' } as const
    render(
      <TextContext.Provider value={useText()}>
        <DialogStackProvider>
          <Dialog {...props} testId="react" modalProps={{ defaultOpen: true }}>
            Body
          </Dialog>
        </DialogStackProvider>
      </TextContext.Provider>,
    )
    mountVue(() => h(DialogVue, { ...props, testId: 'vue', open: true }, () => 'Body'))
    await flushPromises()

    const [react, vue] = [byTestId('react'), byTestId('vue')]
    // The box: the same, plus the enter/exit motion Reka keys on `data-state` (React has it on the
    // full-screen layer around the box, keyed on react-aria's `isEntering`/`isExiting`).
    const motion = classSet({ getAttribute: () => DIALOG_MOTION({ type: 'modal' }) } as never)
    const vueBox = classSet(vue)
    for (const name of motion) vueBox.delete(name)
    expect(vueBox).toEqual(classSet(react))
    // Header, title, scroller and content.
    expect(classSet(vue.querySelector('header'))).toEqual(classSet(react.querySelector('header')))
    expect(classSet(vue.querySelector('h2'))).toEqual(classSet(react.querySelector('h2')))
    const content = (box: HTMLElement) => box.lastElementChild?.firstElementChild?.firstElementChild
    expect(classSet(content(vue))).toEqual(classSet(content(react)))
    // The full-screen layer between the overlay and the box.
    expect(classSet(vue.parentElement)).toEqual(
      classSet(react.closest('[data-testid="modal-dialog"]')),
    )
  })

  test.each([
    { status: 'loading', title: 'Logging out' },
    { status: 'info', title: 'No preview available for this asset', centered: true },
    { status: 'error', title: 'Failed to open project', subtitle: 'Error: boom' },
  ] as const)('Result ($status)', (props) => {
    render(
      <div data-testid="react">
        <Result {...props} />
      </div>,
    )
    mountVue(() => h('div', { 'data-testid': 'vue' }, [h(ResultVue, props)]))
    expect(shape(byTestId('vue'))).toEqual(shape(byTestId('react')))
  })

  test('Result with content', () => {
    render(
      <div data-testid="react">
        <Result status="info" title="Project stopped" subtitle="Open it again">
          <button>Open</button>
        </Result>
      </div>,
    )
    mountVue(() =>
      h('div', { 'data-testid': 'vue' }, [
        h(ResultVue, { status: 'info', title: 'Project stopped', subtitle: 'Open it again' }, () =>
          h('button', 'Open'),
        ),
      ]),
    )
    expect(shape(byTestId('vue'))).toEqual(shape(byTestId('react')))
  })

  test('Loader', () => {
    render(
      <div data-testid="react">
        <Loader minHeight="full" />
      </div>,
    )
    mountVue(() => h('div', { 'data-testid': 'vue' }, [h(LoaderVue, { minHeight: 'full' })]))
    expect(shape(byTestId('vue'))).toEqual(shape(byTestId('react')))
  })
})

describe('the user bar parts render as the React ones (#83)', () => {
  test.each([
    { picture: null, name: 'Ada Lovelace' },
    { picture: 'https://example.com/ada.png', name: 'Ada Lovelace', size: 'xsmall' },
  ] as const)('ProfilePicture %o', (props) => {
    render(
      <div data-testid="react">
        <ProfilePicture {...props} />
      </div>,
    )
    mountVue(() => h('div', { 'data-testid': 'vue' }, [h(ProfilePictureVue, props)]))
    expect(shape(byTestId('vue'))).toEqual(shape(byTestId('react')))
  })
})
