/**
 * @file In-app navigation for links: a plain left click on a link to a page of this app goes
 * through the router instead of reloading the page.
 */
import { inject } from 'vue'
import { routerKey } from 'vue-router'

/**
 * Whether a click on a link should navigate within the app. The link must stay in this window and
 * on this origin, not be a download, and the click must have no modifier key (which asks for a new
 * tab or window).
 */
export function shouldClientNavigate(link: HTMLAnchorElement, event: MouseEvent) {
  const target = link.getAttribute('target')
  return (
    link.href !== '' &&
    (target == null || target === '' || target === '_self') &&
    link.origin === location.origin &&
    !link.hasAttribute('download') &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey
  )
}

/**
 * A click handler for links: when {@link shouldClientNavigate} allows it, it pushes the link's
 * `href` onto the router instead of letting the browser load it. It does nothing outside a router
 * (component tests), or when an earlier handler prevented the default.
 */
export function useClientNavigation() {
  const router = inject(routerKey, null)
  return (event: MouseEvent) => {
    if (router == null || event.defaultPrevented) return
    const link = event.currentTarget
    if (!(link instanceof HTMLAnchorElement)) return
    const href = link.getAttribute('href')
    if (href == null || !shouldClientNavigate(link, event)) return
    event.preventDefault()
    void router.push(href)
  }
}
