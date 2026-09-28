/**
 * @file The code font: which face `--font-mono` uses, and the "Code ligatures" user setting.
 *
 * Both are applied as classes on the document root, so the custom properties they switch in
 * `project-view/assets/base.css` reach every consumer of `--font-mono` — including dashboard
 * portals outside `.App` and the shadow roots of custom-element visualizations, which inherit
 * custom properties but cannot be matched by an ancestor selector.
 */
import { useFeatureFlag } from '$/providers/featureFlags'
import { useZustandStoreRef } from '$/utils/zustand'
import { watchEffect } from 'vue'
import { z } from 'zod'
import { createStore } from 'zustand'
import { persist } from 'zustand/middleware'

/** Root class set while the `enableMonaspaceCodeFont` feature flag is on. */
export const MONASPACE_CODE_FONT_CLASS = 'monaspaceCodeFont'
/** Root class set while the "Code ligatures" setting is on. */
export const CODE_LIGATURES_CLASS = 'codeLigatures'

const CODE_FONT_SETTINGS_SCHEMA = z.object({ codeLigatures: z.boolean() })

/** User settings for the code font. */
export interface CodeFontSettings {
  /**
   * Render Monaspace's coding ligatures (`ss01`-`ss09`: `->`, `>=`, `|>`, `==`, ...) as joined
   * symbols. Applies to read-only code only for now: in the code editor they make caret positions
   * ambiguous (upstream githubnext/monaspace#379).
   */
  readonly codeLigatures: boolean
}

export const codeFontSettingsStore = createStore<CodeFontSettings>()(
  persist((): CodeFontSettings => ({ codeLigatures: false }), {
    name: 'enso-code-font-settings',
    version: 1,
    merge: (persistedState, currentState) => {
      const parsed = CODE_FONT_SETTINGS_SCHEMA.safeParse(persistedState)
      return parsed.success ? { ...currentState, ...parsed.data } : currentState
    },
  }),
)

/** The "Code ligatures" setting, as a Vue ref. */
export function useCodeLigatures() {
  return useZustandStoreRef(codeFontSettingsStore, (state) => state.codeLigatures)
}

/** Change the "Code ligatures" setting. */
export function setCodeLigatures(codeLigatures: boolean) {
  codeFontSettingsStore.setState({ codeLigatures })
}

/**
 * Keep the document root's code-font classes in sync with the feature flag and the setting.
 * Monaspace Neon itself is preloaded from `index.html`.
 */
export function useCodeFontRootClasses(root: HTMLElement = document.documentElement) {
  const monaspace = useFeatureFlag('enableMonaspaceCodeFont')
  const codeLigatures = useCodeLigatures()
  watchEffect(() => {
    root.classList.toggle(MONASPACE_CODE_FONT_CLASS, monaspace.value)
    root.classList.toggle(CODE_LIGATURES_CLASS, codeLigatures.value)
  })
}
