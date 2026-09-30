/** @file React hooks for `LocalStorage`. */
import { useVueValue } from '$/providers/react/common'
import type LocalStorage from '$/utils/LocalStorage'
import type { LocalStorageData } from '$/utils/LocalStorage'
import { useCallback } from 'react'

/** React hook for viewing whole `LocalStorage` contents as a state variable. */
export function useLocalStorageValues(storage: LocalStorage): Partial<LocalStorageData> {
  return useVueValue(
    useCallback(() => {
      // NOTE: `values` is shallowReactive. Create a shallow snapshot to:
      // - avoid deep traversal (stack overflow risk),
      // - provide a new reference so React re-renders.
      const values = storage['values']
      return { ...values }
    }, [storage]),
  )
}
