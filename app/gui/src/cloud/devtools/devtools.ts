/**
 * @file The developer tools' contribution to the protected layout (#172). `registerCloud` calls
 * {@link registerDevtools} in development builds only.
 */
import { contributeDevtools } from '$/providers/layoutContributions'

/** Give the protected layout the developer tools, loaded when they first render. */
export function registerDevtools() {
  contributeDevtools(() => import('./EnsoDevtools.vue'))
}
