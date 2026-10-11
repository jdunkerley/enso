/**
 * @file When the user last acknowledged a downgrade: `PlanDowngradedModal.vue` waits a while before
 * showing again, and `TrialEndedModal.vue` counts as having shown it. Kept in `LocalStorage` under
 * `downgradeModal`, per user: the key and format used before the Vue port (#75).
 */
import LocalStorage from '$/utils/LocalStorage'
import { computed } from 'vue'
import { z } from 'zod'

declare module '$/utils/LocalStorage' {
  /** Metadata containing the last time user has acknowledged the modal with asset removal deadline. */
  interface LocalStorageData {
    readonly downgradeModal: z.infer<typeof STORAGE_SCHEMA>
  }
}

const STORAGE_SCHEMA = z.object({
  lastShownTimestamp: z.number(),
})

LocalStorage.registerKey('downgradeModal', {
  isUserSpecific: true,
  schema: STORAGE_SCHEMA,
})

/** When the downgrade modal was last acknowledged (`0` if never), and how to record that it was. */
export function useDowngradeModalState() {
  const localStorage = LocalStorage.getInstance()

  const lastShownTimestamp = computed(
    () => localStorage.get('downgradeModal')?.lastShownTimestamp ?? 0,
  )

  function markAsShown() {
    localStorage.set('downgradeModal', { lastShownTimestamp: Date.now() })
  }

  return { lastShownTimestamp, markAsShown }
}
