/**
 * @file Waiting for a visualization panel's DOM to be quiet: `prepare_visualization` waits for it
 * before it answers where the panel is, so that main captures a view that has finished drawing.
 */

/** How long a visualization panel's DOM must stay unchanged to count as drawn. */
export const PANEL_QUIET_MS = 250
/** The longest wait for a visualization panel's DOM to be quiet: an animated view never is. */
export const PANEL_QUIET_CAP_MS = 3_000

const OBSERVED = { childList: true, subtree: true, attributes: true, characterData: true }

/**
 * Resolves once nothing in `panel` has changed for {@link PANEL_QUIET_MS}, or after
 * {@link PANEL_QUIET_CAP_MS} or `budgetMs`, whichever is sooner; at once when it is not in the DOM.
 * The open shadow roots inside it (the visualization host's) are watched too, also those of nodes
 * added while it waits: a `MutationObserver` does not cross into one.
 */
export function panelQuiet(panel: HTMLElement | undefined, budgetMs: number): Promise<void> {
  if (panel == null || !panel.isConnected) return Promise.resolve()
  return new Promise((resolve) => {
    let quietTimer: ReturnType<typeof setTimeout> | undefined
    const observed = new Set<Node>()
    const finish = () => {
      observer.disconnect()
      clearTimeout(quietTimer)
      clearTimeout(capTimer)
      resolve()
    }
    const restart = () => {
      clearTimeout(quietTimer)
      quietTimer = setTimeout(finish, PANEL_QUIET_MS)
    }
    const observe = (root: Element | ShadowRoot) => {
      if (observed.has(root)) return
      observed.add(root)
      observer.observe(root, OBSERVED)
    }
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const added of record.addedNodes) {
          if (!(added instanceof Element)) continue
          if (added.shadowRoot != null) observe(added.shadowRoot)
          for (const root of openShadowRoots(added)) observe(root)
        }
      }
      restart()
    })
    observe(panel)
    for (const root of openShadowRoots(panel)) observe(root)
    const capTimer = setTimeout(finish, Math.max(0, Math.min(PANEL_QUIET_CAP_MS, budgetMs)))
    restart()
  })
}

/** The open shadow roots of the elements under `root`, and of those inside them. */
function openShadowRoots(root: Element | ShadowRoot): ShadowRoot[] {
  const found: ShadowRoot[] = []
  for (const element of root.querySelectorAll('*')) {
    if (element.shadowRoot != null) {
      found.push(element.shadowRoot, ...openShadowRoots(element.shadowRoot))
    }
  }
  return found
}
