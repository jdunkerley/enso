/**
 * @file Side-by-side check (#82), as `vuePortParity.test.tsx` does for the primitives: the React
 * `UpsertSecretForm` and its Vue port in `src/cloud/credentials/`, rendered with the same props,
 * produce the same elements, classes, text and accessible names.
 *
 * It lives in the dashboard because it imports the React form (`#/`), which shared code may not.
 */
import { DialogStackProvider } from '#/components/Dialog'
import { UpsertSecretForm } from '#/modals/UpsertSecretModal'
import UpsertSecretFormVue from '$/cloud/credentials/UpsertSecretForm.vue'
import { TextContext } from '$/providers/react'
// Aliased: it is the Vue text store, not a React hook, so it may be called anywhere.
import { useText as textStore } from '$/providers/text'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { SecretId } from 'enso-common/src/services/Backend'
import { afterEach, describe, expect, test } from 'vitest'
import { defineComponent, h } from 'vue'

enableAutoUnmount(afterEach)

const classSet = (element: Element) =>
  new Set(
    element
      .getAttribute('class')
      ?.split(/\s+/)
      .filter((c) => c !== '') ?? [],
  )

/** The attributes that say what a control is, as a user or assistive technology meets it. */
const SEMANTIC_ATTRIBUTES = ['type', 'name', 'placeholder', 'autocomplete', 'role', 'data-testid']

/**
 * The two known differences of the Vue `Button` (see the Button case of `vuePortParity.test.tsx`
 * and `Button.vue`): it applies react-aria's `isFocused` classes always, since they only act under
 * focus anyway, and it wraps its label in a `display: contents` span.
 */
const BUTTON_FOCUS_CLASSES = new Set([
  'focus-visible:outline-2',
  'focus-visible:outline-black',
  'focus-visible:outline-offset-[-2px]',
  'focus:outline-none',
])

/**
 * An element's tree as tags, classes, text and the attributes above: what a rendering looks like
 * with the same stylesheet, and what it says. Generated ids are left out, and so are the Vue
 * button's two known differences.
 */
function shape(element: Element): unknown {
  const classes = [...classSet(element)].filter(
    (c) => element.tagName !== 'BUTTON' || !BUTTON_FOCUS_CLASSES.has(c),
  )
  return {
    tag: element.tagName,
    class: classes.sort(),
    attributes: Object.fromEntries(
      SEMANTIC_ATTRIBUTES.flatMap((name) => {
        const value = element.getAttribute(name)
        return value == null ? [] : [[name, value]]
      }),
    ),
    children: [...element.childNodes].flatMap(function shapes(node): unknown[] {
      return (
        node instanceof Element ?
          node.tagName === 'SPAN' && node.getAttribute('class') === 'contents' ?
            [...node.childNodes].flatMap(shapes)
          : [shape(node)]
        : node.nodeType === Node.TEXT_NODE && node.textContent?.trim() ? [node.textContent.trim()]
        : []
      )
    }),
  }
}

function byTestId(side: string) {
  const element = document.querySelector(
    `[data-testid="${side}"] [data-testid="upsert-secret-modal"]`,
  )
  if (element == null) throw new Error(`No ${side} form`)
  return element
}

function renderBoth(props: { secretId?: SecretId; name?: string }) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TextContext.Provider value={textStore()}>
        <DialogStackProvider>
          <div data-testid="react">
            <UpsertSecretForm {...props} doCreate={() => {}} doCancel={() => {}} />
          </div>
        </DialogStackProvider>
      </TextContext.Provider>
    </QueryClientProvider>,
  )
  mount(
    defineComponent({
      setup: () => () =>
        h('div', { 'data-testid': 'vue' }, [h(UpsertSecretFormVue, { ...props, cancel: 'emit' })]),
    }),
    { attachTo: document.body },
  )
}

describe('the Vue UpsertSecretForm renders as the React one', () => {
  test('creating a secret: name, value, Create and Cancel', async () => {
    renderBoth({})
    await flushPromises()
    expect(shape(byTestId('vue'))).toEqual(shape(byTestId('react')))
  })

  test('updating a secret: only the value, with a hidden placeholder, and Update', async () => {
    renderBoth({ secretId: 'secret-1' as SecretId, name: 'api-key' })
    await flushPromises()
    expect(shape(byTestId('vue'))).toEqual(shape(byTestId('react')))
  })
})
