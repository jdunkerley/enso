/** @file App-wide side effects that `App.vue` sets up once. */
import { useFeatureFlag } from '$/providers/featureFlags'
import { isElementPartOfMonaco, isElementTextInput } from '$/utils/event'
import { useEventListener } from '@vueuse/core'
import { IS_DEV_MODE } from 'enso-common/src/utilities/detect'
import { watchEffect } from 'vue'
import { useRouter } from 'vue-router'

/**
 * Keep the `theme-dark` class on the document in sync with the dark-theme flag, and remember the
 * theme for `index.html`, which applies it before the app loads.
 */
export function useThemeClass() {
  const isDarkTheme = useFeatureFlag('unsafeDarkTheme')
  watchEffect(() => {
    document.documentElement.classList.toggle('theme-dark', isDarkTheme.value)
    localStorage.setItem('enso-theme', isDarkTheme.value ? 'dark' : 'light')
  })
}

/**
 * Clear the text selection on a plain click (one that did not start a selection) outside text
 * inputs, unless the selection is inside the project view.
 */
export function useClearSelectionOnClick() {
  let isClick = false
  useEventListener(document, 'mousedown', () => {
    isClick = true
  })
  useEventListener(document, 'selectstart', () => {
    isClick = false
  })
  useEventListener(document, 'mouseup', (event) => {
    if (
      !isClick ||
      isElementTextInput(event.target) ||
      isElementPartOfMonaco(event.target) ||
      isElementTextInput(document.activeElement)
    ) {
      return
    }
    const selection = document.getSelection()
    const app = document.getElementById('ProjectView')
    const appContainsSelection =
      app != null &&
      selection != null &&
      selection.anchorNode != null &&
      app.contains(selection.anchorNode) &&
      selection.focusNode != null &&
      app.contains(selection.focusNode)
    if (!appContainsSelection) {
      selection?.removeAllRanges()
    }
  })
}

/** In development builds, expose the router's `push` as `window.navigate`, for debugging. */
export function useDevNavigate() {
  if (!IS_DEV_MODE) return
  const router = useRouter()
  Object.assign(window, { navigate: router.push.bind(router) })
}
