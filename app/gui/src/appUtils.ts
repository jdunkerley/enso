/** @file Constants related to the application root component. */

/** Path to page in which the currently active payment plan can be managed. */
export const SUBSCRIBE_PATH = '/subscribe'

// === Constants related to URLs ===

export const SEARCH_PARAMS_PREFIX = 'cloud-ide_'
/** Return the email address for contacting support. */
export const SUPPORT_EMAIL = 'cloud@enso.org'
/** Return the `mailto:` URL for contacting support. */
export const SUPPORT_EMAIL_URL = `mailto:${SUPPORT_EMAIL}`

/** Return url address of Enso Analytics contact page. */
export function getContactPage(): string {
  return `${$config.HOST}/contact`
}

/** Return the mailto URL for contacting sales. */
export function getSalesEmail(): string {
  return 'mailto:contact@enso.org'
}
