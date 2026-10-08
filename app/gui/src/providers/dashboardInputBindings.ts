/**
 * @file The dashboard's keyboard and mouse bindings (`$/configurations/inputBindings`), one set per
 * window, with the user's changes to them: the dashboard's global shortcuts
 * (`$/components/DashboardPage.vue`), the menus and the drive all read the same set. They are the dashboard's half of the window's bindings,
 * `$/providers/inputBindings` (#170), which also holds the graph editor's, loads and saves both,
 * and is what the Keyboard shortcuts settings tab edits.
 */
import {
  createInputBindingsStore,
  getInputBindingsStore,
  type InputBindingsStorage,
} from '$/providers/inputBindings'

/**
 * The dashboard's bindings of a new store over `localStorage`: for tests, which need a store of
 * their own.
 */
export function createDashboardInputBindings(localStorage?: InputBindingsStorage) {
  return createInputBindingsStore(localStorage).dashboard
}

/** The dashboard's bindings, with the user's changes. */
export type DashboardInputBindings = ReturnType<typeof createDashboardInputBindings>

/** The window's dashboard bindings, created (and the user's changes loaded) on first use. */
export function getDashboardInputBindings(): DashboardInputBindings {
  return getInputBindingsStore().dashboard
}

/** {@link getDashboardInputBindings}, under the name Vue code uses. */
export const useDashboardInputBindings = getDashboardInputBindings
