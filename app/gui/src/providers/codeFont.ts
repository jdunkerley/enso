/**
 * @file The "Code ligatures" and "Handwritten comments" user settings for the code font (Monaspace
 * Neon, `--font-mono` in `project-view/assets/base.css`).
 *
 * Both are applied as classes on the document root, so the custom properties they switch in
 * `project-view/assets/base.css` reach every consumer of `--font-mono` — including dashboard
 * portals outside `.App` and the shadow roots of custom-element visualizations, which inherit
 * custom properties but cannot be matched by an ancestor selector.
 */
import { useZustandStoreRef } from '$/utils/zustand'
import { watchEffect } from 'vue'
import { z } from 'zod'
import { createStore } from 'zustand'
import { persist } from 'zustand/middleware'

/** Root class set while the "Code ligatures" setting is on. */
export const CODE_LIGATURES_CLASS = 'codeLigatures'
/** Root class set while the "Handwritten comments" setting is on. */
export const HANDWRITTEN_COMMENTS_CLASS = 'handwrittenComments'

/** User settings for the code font. */
export interface CodeFontSettings {
  /**
   * Render Monaspace's coding ligatures (`ss01`-`ss09`: `->`, `>=`, `|>`, `==`, ...) as joined
   * symbols. Applies to read-only code only for now: in the code editor they make caret positions
   * ambiguous (upstream githubnext/monaspace#379).
   */
  readonly codeLigatures: boolean
  /**
   * Render comments in the code editor, and node comments in the graph, in Monaspace Radon, the
   * handwriting face of the Monaspace superfamily. Radon shares Neon's advance width, so code editor
   * comments stay on the code's column grid.
   */
  readonly handwrittenComments: boolean
}

const DEFAULT_CODE_FONT_SETTINGS: CodeFontSettings = {
  codeLigatures: false,
  handwrittenComments: true,
}

// Every field has a default, so that settings persisted before a setting existed still load.
const CODE_FONT_SETTINGS_SCHEMA = z.object({
  codeLigatures: z.boolean().default(DEFAULT_CODE_FONT_SETTINGS.codeLigatures),
  handwrittenComments: z.boolean().default(DEFAULT_CODE_FONT_SETTINGS.handwrittenComments),
})

export const codeFontSettingsStore = createStore<CodeFontSettings>()(
  persist((): CodeFontSettings => ({ ...DEFAULT_CODE_FONT_SETTINGS }), {
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

/** The "Handwritten comments" setting, as a Vue ref. */
export function useHandwrittenComments() {
  return useZustandStoreRef(codeFontSettingsStore, (state) => state.handwrittenComments)
}

/** Change the "Handwritten comments" setting. */
export function setHandwrittenComments(handwrittenComments: boolean) {
  codeFontSettingsStore.setState({ handwrittenComments })
}

/**
 * Keep the document root's code-font classes in sync with the settings, and start loading Monaspace
 * Radon, for comments, while the "Handwritten comments" setting is on. Monaspace Neon itself is preloaded from `index.html`.
 *
 * Radon (0.8 MB) is wanted only with the setting on, which `index.html` cannot know, so it is not
 * preloaded; asking the `FontFaceSet` for it here starts the download at app start-up, well before
 * the code editor renders.
 */
export function useCodeFontRootClasses(root: HTMLElement = document.documentElement) {
  const codeLigatures = useCodeLigatures()
  const handwrittenComments = useHandwrittenComments()
  watchEffect(() => {
    root.classList.toggle(CODE_LIGATURES_CLASS, codeLigatures.value)
    root.classList.toggle(HANDWRITTEN_COMMENTS_CLASS, handwrittenComments.value)
    // `document.fonts` is missing in some test environments (jsdom). A failed load needs no
    // handling here: comments fall back to the rest of the `--font-mono-comment` stack.
    if (handwrittenComments.value && 'fonts' in document) {
      document.fonts.load('1em "Monaspace Radon"').catch(() => {})
    }
  })
}
