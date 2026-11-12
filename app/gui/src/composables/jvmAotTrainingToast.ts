/**
 * @file The toast shown while the JDK AOT cache trains (Electron with the JVM engine, at the first
 * launch and after a `jvm.options` change), then says how it ended.
 */
import type { JvmAotApi } from '$/electronApi'
import { useText } from '$/providers/text'
import { useToasts, type ToastId } from '$/providers/toasts'
import type { JvmAotTrainingStatus } from 'enso-common/src/jvmAot'
import { onScopeDispose } from 'vue'

const TOAST_ID: ToastId = 'jvm-aot-training'
/**
 * Bottom-right, not the default top centre: the training toast stays for minutes, and at the top
 * centre it covers the graph editor's toolbar (Add Component) for all that time.
 */
const POSITION = 'bottom-right'

/**
 * Follow the training: while it runs, a toast with a spinner that stays until it ends (or the user
 * closes it); a success replaces it with "Engine ready", which closes by itself, and a failure with
 * a message that stays until closed. A window that loads mid-training asks for the status, so it
 * shows the toast too; one that loads after the end shows nothing. Nothing happens outside
 * Electron.
 */
export function useJvmAotTrainingToast(api: JvmAotApi | undefined = window.api?.jvmAot) {
  if (api == null) return
  const toasts = useToasts()
  const { getText } = useText()
  /** Whether this window has seen the training run: only then is its end worth a toast. */
  let sawTraining = false
  /** A status was broadcast: the answer to the query on load may be older, so it is ignored. */
  let notified = false

  /** Replace the toast's content, or show it again when the user has closed it. */
  function showOutcome(
    text: string,
    options: { type: 'success' | 'warning'; autoClose: false | null },
  ) {
    const outcome = { ...options, isLoading: null }
    if (toasts.isActive(TOAST_ID) || toasts.isQueued(TOAST_ID)) {
      toasts.update(TOAST_ID, { ...outcome, render: text })
    } else {
      toasts.show(text, { ...outcome, toastId: TOAST_ID, position: POSITION })
    }
  }

  function apply(status: JvmAotTrainingStatus) {
    switch (status) {
      case 'training': {
        sawTraining = true
        toasts.show(getText('jvmAotTrainingToast'), {
          toastId: TOAST_ID,
          position: POSITION,
          type: 'info',
          isLoading: true,
          autoClose: false,
        })
        break
      }
      case 'trained': {
        // `null`: the default auto-close, a few seconds.
        if (sawTraining) {
          showOutcome(getText('jvmAotTrainedToast'), { type: 'success', autoClose: null })
        }
        break
      }
      case 'failed': {
        if (sawTraining) {
          showOutcome(getText('jvmAotTrainingFailedToast'), { type: 'warning', autoClose: false })
        }
        break
      }
      case 'idle':
        break
    }
  }

  onScopeDispose(
    api.onTrainingStatus((status) => {
      notified = true
      apply(status)
    }),
  )
  api.trainingStatus().then(
    (status) => {
      if (!notified) apply(status)
    },
    (error: unknown) => console.warn('Could not ask whether the engine is being prepared:', error),
  )
}
