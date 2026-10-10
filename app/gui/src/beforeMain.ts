/**
 * @file This module is guaranteed to be imported first, and thus to execute before any
 * other script (including our dependencies).
 */

declare const __VUE_DEVTOOLS_KIT_CONTEXT__: any
declare const __VUE_DEVTOOLS_OPEN_IN_EDITOR_BASE_URL__: string | undefined

DEV: {
  // Restore the "open editor" function in devtools, without introducing extra DOM properties.
  if (typeof __VUE_DEVTOOLS_KIT_CONTEXT__ !== 'undefined') {
    __VUE_DEVTOOLS_KIT_CONTEXT__.api.openInEditor = async (options: {
      file: string
      baseUrl?: string
      line?: number
      column?: number
    }) => {
      const { file, baseUrl, line = 0, column = 0 } = options
      const _baseUrl = baseUrl ?? __VUE_DEVTOOLS_OPEN_IN_EDITOR_BASE_URL__ ?? window.location.origin
      const fileLocation = `${file}:${line}:${column}`
      return fetch(`${_baseUrl}/__open-in-editor?file=${encodeURIComponent(fileLocation)}`)
    }
  }
}
