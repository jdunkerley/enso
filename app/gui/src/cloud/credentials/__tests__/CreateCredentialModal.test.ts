/**
 * @file The "New Credential" dialog (#198): its list of types, each type's form, the fields'
 * errors, and that a submission creates the credential, opens the sign-in page and closes the
 * dialog; a failure shows a toast (Snowflake, Strava, Microsoft 365, Salesforce) or the form's
 * error (Google).
 */
import {
  byTestId,
  mountWithProviders,
  usePrimitiveTestEnvironment,
} from '$/components/__tests__/mountWithProviders'
import { useText } from '$/providers/text'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import { SecretId, type CredentialConfig } from 'enso-common/src/services/Backend'
import { beforeAll, describe, expect, test, vi } from 'vitest'
import { h } from 'vue'
import CreateCredentialModal from '../CreateCredentialModal.vue'

const openInNewBrowserTab = vi.hoisted(() => vi.fn())
vi.mock('$/utils/window', () => ({ openInNewBrowserTab }))
vi.mock('$/providers/config', () => ({
  useConfig: () => ({
    remoteConfig: {
      ENSO_IDE_API_URL: 'https://api.example.com',
      ENSO_IDE_GOOGLE_OAUTH_CLIENT_ID: 'google-client',
      ENSO_IDE_STRAVA_OAUTH_CLIENT_ID: 'strava-client',
      ENSO_IDE_MS365_OAUTH_CLIENT_ID: 'ms365-client',
      ENSO_IDE_SALESFORCE_OAUTH_CLIENT_ID: 'salesforce-client',
    },
  }),
}))
const showToast = vi.hoisted(() => vi.fn())
vi.mock('$/providers/toasts', () => ({ useToasts: () => ({ show: showToast }) }))

usePrimitiveTestEnvironment()
const { getText } = useText()
// jsdom has no layout: Reka's list scrolls its chosen option into view.
beforeAll(() => {
  Element.prototype.scrollIntoView ??= () => {}
})

function mountModal(doCreate = vi.fn(async () => SecretId('secret-1'))) {
  const onClose = vi.fn()
  mountWithProviders(() => h(CreateCredentialModal, { doCreate, onClose }))
  return { doCreate, onClose }
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!
const button = (name: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === name)
const inputLabelled = (label: string) =>
  [...dialog().querySelectorAll<HTMLInputElement>('input')].find(
    (input) => input.closest('label')?.textContent?.trim().startsWith(label) === true,
  )

async function chooseType(name: string) {
  const option = [...dialog().querySelectorAll('[role="option"]')].find(
    (o) => o.textContent?.trim() === name,
  )!
  await userEvent.setup().click(option)
  await flushPromises()
}

describe('CreateCredentialModal', () => {
  test('lists the five types, Snowflake first, and shows its form', async () => {
    mountModal()
    await flushPromises()
    expect(dialog().querySelector('h2')!.textContent).toBe(getText('newCredential'))
    const list = dialog().querySelector(
      `[role="listbox"][aria-label="${getText('credentialTypeLabel')}"]`,
    )!
    expect([...list.querySelectorAll('[role="option"]')].map((o) => o.textContent?.trim())).toEqual(
      ['Snowflake', 'Google', 'Strava', 'Microsoft 365', 'Salesforce'],
    )
    for (const label of ['Name', 'Account', 'Client ID', 'Client Secret', 'Role']) {
      expect(inputLabelled(label), label).toBeDefined()
    }
    expect(dialog().querySelector('a')!.getAttribute('href')).toBe(
      'https://help.enso.org/docs/using-enso/connecting-to-snowflake#oauth-integration',
    )
  })

  test('an empty Snowflake form shows each field error and creates nothing', async () => {
    const { doCreate } = mountModal()
    await flushPromises()
    await userEvent.setup().click(button(getText('create'))!)
    await flushPromises()
    expect(dialog().textContent).toContain('Please fill out this field')
    expect(doCreate).not.toHaveBeenCalled()
  })

  test('Snowflake: creates the credential, opens the sign-in page, and closes', async () => {
    const { doCreate, onClose } = mountModal()
    await flushPromises()
    const user = userEvent.setup()
    await user.type(inputLabelled('Name')!, 'sf')
    await user.type(inputLabelled('Account')!, 'acct')
    await user.type(inputLabelled('Client ID')!, 'id')
    await user.type(inputLabelled('Client Secret')!, 'secret')
    await user.type(inputLabelled('Role')!, 'role')
    await user.click(button(getText('create'))!)
    await flushPromises()
    expect(doCreate).toHaveBeenCalledOnce()
    const [name, config] = doCreate.mock.calls[0]! as unknown as [string, CredentialConfig]
    expect(name).toBe('sf')
    expect(config.input).toMatchObject({ type: 'Snowflake', account: 'acct', role: 'role' })
    expect(openInNewBrowserTab).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/acct\.snowflakecomputing\.com\/oauth\/authorize\?/),
    )
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  test('switching type shows that type form, with its defaults', async () => {
    mountModal()
    await flushPromises()
    await chooseType('Google')
    const checkboxes = [...dialog().querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
    expect(checkboxes.map((c) => c.checked)).toEqual([true, false])
    // Named by their own text, not by the whole group.
    expect(
      document.getElementById(checkboxes[0]!.getAttribute('aria-labelledby')!)!.textContent,
    ).toBe(getText('googleCredentialSheetsScope'))
    await chooseType('Microsoft 365')
    expect(inputLabelled('Name')!.value).toBe('Microsoft365')
    expect(dialog().textContent).toContain(
      getText('ms365CredentialFilesPermissionFilesReadWriteAllDescription'),
    )
    await userEvent
      .setup()
      .click(
        [...dialog().querySelectorAll('label')].find(
          (l) => l.textContent?.trim() === getText('ms365CredentialFilesPermissionFilesRead'),
        )!,
      )
    expect(dialog().textContent).toContain(
      getText('ms365CredentialFilesPermissionFilesReadDescription'),
    )
    await chooseType('Salesforce')
    expect(inputLabelled('Name')!.value).toBe('Salesforce')
    expect(dialog().textContent).toContain(getText('salesforceCredentialScopesSummary'))
  })

  test('a failed creation shows a toast for Strava, and closes', async () => {
    const { onClose } = mountModal(vi.fn(async () => Promise.reject(new Error('No such scope'))))
    await flushPromises()
    await chooseType('Strava')
    const user = userEvent.setup()
    await user.type(inputLabelled('Name')!, 'strava')
    await user.click(button(getText('create'))!)
    await flushPromises()
    expect(showToast).toHaveBeenCalledWith('No such scope', { type: 'error' })
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  test('a failed creation shows the form error for Google, and stays open', async () => {
    const { onClose } = mountModal(vi.fn(async () => Promise.reject(new Error('Nope'))))
    await flushPromises()
    await chooseType('Google')
    const user = userEvent.setup()
    await user.type(inputLabelled('Name')!, 'g')
    await user.click(button(getText('create'))!)
    await flushPromises()
    expect(byTestId('form-submit-error')?.textContent).toContain('Nope')
    expect(onClose).not.toHaveBeenCalled()
  })

  test('Escape closes it; an outside click does not', async () => {
    const { onClose } = mountModal()
    await flushPromises()
    const user = userEvent.setup()
    await user.click(byTestId('modal-dialog')!)
    expect(onClose).not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled())
  })
})
