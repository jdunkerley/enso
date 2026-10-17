/**
 * @file The right panel's tabs whose content other parts of the app contribute, without the core
 * importing them (decision 6b of `docs/superpowers/specs/2026-09-30-react-to-vue-foundations.md`).
 * Only the Versions tab is contributed now (`src/registerCore.ts`); the Properties and Schedule
 * tabs were the cloud's, and nothing contributes them since it was removed.
 *
 * The tabs themselves (icon, title, when they are enabled) stay in `$/providers/rightPanel`, in
 * their place among the others; a contributable tab that nothing contributed is hidden. A
 * contribution is a loader, so that the tab's code stays out of the initial chunk and the
 * dashboard's until the tab first opens; `RightPanel.vue` shows a loader meanwhile. This module
 * imports no component, since `registerCore` reaches it from the app's entry.
 */
import { shallowReactive, type Component } from 'vue'

/** A right-panel tab whose content can be contributed: Properties, Versions and Schedule. */
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
