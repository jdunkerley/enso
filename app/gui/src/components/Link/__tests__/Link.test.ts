/**
 * @file `Link` and the client navigation it shares with `Button`: what react-aria's
 * `RouterProvider` did for the React links.
 */
import Button from '$/components/Button/Button.vue'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import Link from '../Link.vue'

const anchor = () => document.querySelector('a')!

// jsdom cannot load another page: stop a click the app leaves to the browser, once the app's own
// handler has seen it.
const stopBrowserNavigation = (event: Event) => event.preventDefault()
beforeEach(() => document.addEventListener('click', stopBrowserNavigation))
afterEach(() => document.removeEventListener('click', stopBrowserNavigation))

describe('Link', () => {
  test('renders a link with its icon and text, focusable from the keyboard', async () => {
    await mountWithProviders(Link, { props: { to: '/somewhere', icon: 'at', text: 'Go' } })
    expect(anchor().getAttribute('href')).toBe('/somewhere')
    expect(anchor().textContent?.trim()).toBe('Go')
    expect(anchor().querySelector('svg')).not.toBeNull()
    await userEvent.setup().tab()
    expect(document.activeElement).toBe(anchor())
  })

  test('a plain click navigates in the app; Enter does too', async () => {
    const { router } = await mountWithProviders(Link, {
      route: '/start',
      props: { to: '/somewhere?a=1', icon: 'at', text: 'Go' },
    })
    await userEvent.setup().click(anchor())
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/somewhere?a=1')

    await router.push('/start')
    anchor().focus()
    await userEvent.setup().keyboard('{Enter}')
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/somewhere?a=1')
  })

  test('a click with a modifier key is left to the browser', async () => {
    const { router } = await mountWithProviders(Link, {
      route: '/start',
      props: { to: '/somewhere', icon: 'at', text: 'Go' },
    })
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true })
    anchor().dispatchEvent(event)
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/start')
  })
})

describe('Button with an `href`', () => {
  test('navigates in the app for a link of this app', async () => {
    const { router } = await mountWithProviders(Button, {
      route: '/start',
      props: { href: '/forgot-password' },
      slots: { default: () => 'Forgot?' },
    })
    expect(anchor().getAttribute('target')).toBeNull()
    await userEvent.setup().click(anchor())
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/forgot-password')
  })

  test('leaves an external link to the browser, in a new tab', async () => {
    const { router } = await mountWithProviders(Button, {
      route: '/start',
      props: { href: 'https://example.com/eula' },
      slots: { default: () => 'EULA' },
    })
    expect(anchor().getAttribute('target')).toBe('_blank')
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    anchor().dispatchEvent(event)
    await flushPromises()
    expect(router.currentRoute.value.fullPath).toBe('/start')
  })
})
