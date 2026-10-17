/**
 * @file The right panel's tabs whose content other parts of the app contribute: the contribution
 * point through which other parts of the app (`src/registerCore.ts`: the Versions tab) fill the
 * Properties, Versions and Schedule tabs, without the core importing them (decision 6b of
 * `docs/superpowers/specs/2026-09-30-react-to-vue-foundations.md`).
 *
 * The tabs themselves (icon, title, when they are enabled) stay in `$/providers/rightPanel`, in
 * their place among the others; a contributable tab that nothing contributed is hidden, so a tab
 * nothing contributes is not shown. A contribution is a loader, so that the tab's code stays
 * out of the initial chunk and the dashboard's until the tab first opens; `RightPanel.vue` shows a
 * loader meanwhile. This module imports no
 * component, since `registerCore` reaches it from the app's entry.
 */
import { shallowReactive, type Component } from 'vue'

/** A right-panel tab whose content is contributed: Properties, Versions and Schedule. */
export type ContributedRightPanelTab = 'settings' | 'versions' | 'executionsCalendar'

/** Loads a tab's component. */
export type RightPanelTabLoader = () => Promise<Component | { default: Component }>

const contributions = shallowReactive(new Map<ContributedRightPanelTab, RightPanelTabLoader>())

/**
 * Give a right-panel tab its content. Call it before the app starts; a later call for the same tab
 * replaces the earlier one.
 */
export function contributeRightPanelTab(tab: ContributedRightPanelTab, load: RightPanelTabLoader) {
  contributions.set(tab, load)
}

/** The loader of a tab's contributed content, if any. Reactive. */
export function rightPanelTabContribution(
  tab: ContributedRightPanelTab,
): RightPanelTabLoader | undefined {
  return contributions.get(tab)
}

/** Forget every contribution. For tests. */
export function resetRightPanelContributions() {
  contributions.clear()
}
