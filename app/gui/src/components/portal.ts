/**
 * @file Where the Vue primitives' overlays (dialogs, popovers, menus, tooltips) render.
 *
 * They go into the same root as the React overlays (`#enso-portal-root`, in `index.html`), so both
 * frameworks' popups share one stacking context and the dashboard's base styles
 * (`:where(.enso-portal-root)`). A test without that element falls back to `body`.
 */

/** The element Vue overlays teleport into. Read at render time, not at import time. */
export function portalTarget(): HTMLElement | 'body' {
  return document.getElementById('enso-portal-root') ?? 'body'
}
