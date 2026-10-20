/**
 * @file The reminder to rotate the secrets key: once the key is a year old, a toast at start-up,
 * and again every month after the user asks to be reminded later. A key that comes from
 * `ENSO_SECRETS_KEY` is not ours to rotate, so it never prompts.
 */
import { SEARCH_PARAMS_PREFIX } from '$/appUtils'
import SettingsTabType from '$/configurations/settingsTabs'
import { useBackends } from '$/providers/backends'
import { useToasts, type ToastId } from '$/providers/toasts'
import SecretsKeyReminderToast from '$/secrets/SecretsKeyReminderToast.vue'
import { createPersistedStore } from '$/utils/persistedStore'
import { watch } from 'vue'
import { useRouter } from 'vue-router'
import { z } from 'zod'

/** How old the key is, in days, before it is due for rotation. */
export const KEY_MAX_AGE_DAYS = 365
/** How long "Remind me in a month" waits, in days. */
const SNOOZE_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000
const TOAST_ID: ToastId = 'secrets-key-reminder'

interface ReminderState {
  /** An ISO-8601 time before which the reminder stays quiet, or `null`. */
  readonly snoozedUntil: string | null
}

const REMINDER_SCHEMA = z.object({ snoozedUntil: z.string().nullable().default(null) })

const reminderStore = createPersistedStore<ReminderState>(() => ({ snoozedUntil: null }), {
  name: 'enso-secrets-reminder',
  version: 1,
  merge: (persistedState, currentState) => {
    const parsed = REMINDER_SCHEMA.safeParse(persistedState)
    return parsed.success ? { ...currentState, ...parsed.data } : currentState
  },
})

/**
 * Whether the key made at `keyCreated` is due for rotation at `now`: it is at least a year old,
 * and any snooze (`snoozedUntil`) has ended. A date that cannot be read is never due.
 */
export function isKeyDue(keyCreated: string, now: Date, snoozedUntil: string | null): boolean {
  const created = Date.parse(keyCreated)
  if (Number.isNaN(created)) return false
  if (now.getTime() - created < KEY_MAX_AGE_DAYS * DAY_MS) return false
  if (snoozedUntil == null) return true
  const until = Date.parse(snoozedUntil)
  return Number.isNaN(until) || now.getTime() >= until
}

/** Stay quiet about the key for 30 days from `now`. */
export function snoozeForAMonth(now: Date) {
  reminderStore.setState({
    snoozedUntil: new Date(now.getTime() + SNOOZE_DAYS * DAY_MS).toISOString(),
  })
}

/**
 * Check the key's age once the local backend is there, and show the reminder toast if it is due.
 * Nothing happens in the browser build, which has no secrets key.
 */
export function useSecretsKeyReminder() {
  if (window.api?.secrets == null) return
  const backends = useBackends()
  const toasts = useToasts()
  const router = useRouter()

  function openSettings() {
    void router.push({
      path: '/settings',
      query: { [`${SEARCH_PARAMS_PREFIX}SettingsTab`]: JSON.stringify(SettingsTabType.local) },
    })
  }

  async function check(backend: NonNullable<typeof backends.localBackend>) {
    try {
      const status = await backend.secretsStatus()
      if (status.state !== 'ready' || status.keyFromEnvironment || status.keyCreated == null) return
      if (!isKeyDue(status.keyCreated, new Date(), reminderStore.getState().snoozedUntil)) return
      toasts.show(
        {
          component: SecretsKeyReminderToast,
          props: {
            onRotate: () => {
              toasts.dismiss(TOAST_ID)
              openSettings()
            },
            onSnooze: () => {
              snoozeForAMonth(new Date())
              toasts.dismiss(TOAST_ID)
            },
          },
        },
        { toastId: TOAST_ID, type: 'info', autoClose: false },
      )
    } catch {
      // A reminder is never worth an error: Settings shows the status problem itself.
    }
  }

  let checked = false
  watch(
    () => backends.localBackend,
    (backend) => {
      if (backend == null || checked) return
      checked = true
      void check(backend)
    },
    { immediate: true },
  )
}
