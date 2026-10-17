import * as gtag from '$/utils/analytics/gtag'
import * as detect from 'enso-common/src/utilities/detect'

/** Log when the app is opened and closed. */
export function appOpenCloseCallback(): () => void {
  gtag.gtag('set', { platform: detect.platform(), architecture: detect.architecture() })
  return gtag.openCloseCallback('open_app', 'close_app')
}

/** Log when a workflow tab is opened. */
export function workflowOpened(): void {
  gtag.event('open_workflow')
}

/** Log when a workflow tab is closed. */
export function workflowClosed(): void {
  gtag.event('close_workflow')
}
