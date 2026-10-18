import type { UserSession } from '$/providers/auth'
import { useText } from '$/providers/text'
import type { ToValue } from '$/utils/reactivity'
import { computed, toValue, watch } from 'vue'

/**
 * Composable for managing the app title.
 *
 * Appends "Not for commercial use" to the document title. There is always a session, the local
 * one: there is no sign-in, and no paid plan.
 * @param userSession - Reactive reference to the user session data
 */
export function useAppTitle(userSession: ToValue<UserSession>) {
  const originalTitle = document.title
  const text = useText()
  const commercialUseNotice = text.getText('commercialUseNotice', originalTitle)

  const shouldShowCommercialNotice = computed(() => {
    return toValue(userSession) != null
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
