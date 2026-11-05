/**
 * @file Where the save shortcuts (`Mod+S`, `Mod+Shift+S`) act. They work anywhere in the project
 * view, the code editor, the documentation panel and the bottom dock included, but only on what
 * belongs to the open project: a side panel that shows something else (the drive's tools in the
 * left panel, an asset's documentation in the right one) is not the project's. Nor are the
 * command palette, the component browser (whose half-typed input a save would not include) and the
 * tab bar, which mark themselves with `data-no-save-shortcut`.
 */
import type { ProjectId } from 'enso-common/src/services/Backend'

/** Marks the content of a side panel, with the side (`PanelContents.vue`). */
const PANEL_CONTENT_SELECTOR = '[data-panel-side]'

/** Marks a part of the project view where the save shortcuts do not act. */
const NO_SAVE_SELECTOR = '[data-no-save-shortcut]'

/**
 * Whether the save shortcuts act for the project `projectId` when `target` has the focus.
 * @param target - the first element of the key event's composed path.
 * @param rightPanelProject - the project the right panel is about (`useRightPanelData().focusedProject`).
 */
export function saveShortcutInScope(
  target: EventTarget | null,
  projectId: ProjectId,
  rightPanelProject: ProjectId | undefined,
): boolean {
  if (!(target instanceof Element)) return true
  if (target.closest(NO_SAVE_SELECTOR) != null) return false
  const panel = target.closest(PANEL_CONTENT_SELECTOR)
  if (panel == null) return true
  return panel.getAttribute('data-panel-side') === 'right' && rightPanelProject === projectId
}
