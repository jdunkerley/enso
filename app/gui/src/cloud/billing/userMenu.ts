/** @file The user menu's billing entry (#83). */
import { SUBSCRIBE_PATH } from '$/appUtils'
import type { MenuEntryAction } from '$/composables/menuEntries'
import type { UserSession } from '$/providers/auth'
import { Plan } from 'enso-common/src/services/Backend'
import type { Router } from 'vue-router'

/**
 * "Upgrade Plan", for a user on the free or solo plan: it goes to the subscription page, after
 * `onSignOut` (which closes the open projects).
 */
export function upgradePlanEntry(
  user: UserSession['user'],
  router: Router,
  onSignOut: () => void,
): MenuEntryAction | false {
  return (
    (user.plan === Plan.free || user.plan === Plan.solo) && {
      action: 'upgradePlan',
      doAction: () => {
        onSignOut()
        void router.push(SUBSCRIBE_PATH)
      },
    }
  )
}
