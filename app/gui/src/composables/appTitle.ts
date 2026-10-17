import type { UserSession } from '$/providers/auth'
import { useText } from '$/providers/text'
import type { ToValue } from '$/utils/reactivity'
import { Plan } from 'enso-common/src/services/Backend'
import type { Opt } from 'enso-common/src/utilities/data/opt'
import { computed, toValue, watch } from 'vue'

/**
 * Composable for managing the app title based on the user's plan.
 *
 * Appends "Not for commercial use" to the document title when the user is on the Free plan, as the
 * local user always is. There is no sign-in: the session is the local one.
 * @param userSession - Reactive reference to the user session data
 */
export function useAppTitle(userSession: ToValue<Opt<UserSession>>) {
  const originalTitle = document.title
  const text = useText()
  const commercialUseNotice = text.getText('commercialUseNotice', originalTitle)

  const shouldShowCommercialNotice = computed(() => {
    const session = toValue(userSession)
    return session?.user?.plan === Plan.free
  })

  watch(shouldShowCommercialNotice, (shouldShow) => {
    if (shouldShow) {
      if (!document.title.includes(commercialUseNotice)) {
        document.title = commercialUseNotice
      }
    } else {
      document.title = originalTitle
    }
  })

  return {
    shouldShowCommercialNotice,
  }
}
