/** @file The toast shown when the app goes offline or comes back online. */
import { useOfflineNotification } from '$/composables/offlineNotification'
import { useText } from '$/providers/text'
import { useToasts } from '$/providers/toasts'
import { onlineManager } from '@tanstack/vue-query'
import { afterEach, describe, expect, test } from 'vitest'
import { effectScope, nextTick } from 'vue'

const { getText } = useText()

afterEach(() => {
  onlineManager.setOnline(true)
  const toasts = useToasts()
  for (const toast of toasts.toasts.value) toasts.remove(toast.id)
})

/** The contents of the toasts that are shown and not closing. */
function shownToasts() {
  return useToasts()
    .toasts.value.filter((toast) => toast.isIn)
    .map((toast) => toast.content)
}

describe('useOfflineNotification', () => {
  test('says nothing about the state the app starts in', async () => {
    const scope = effectScope()
    scope.run(useOfflineNotification)
    await nextTick()
    expect(shownToasts()).toEqual([])
    scope.stop()
  })

  test('replaces the toast as the app goes offline and comes back', async () => {
    const scope = effectScope()
    scope.run(useOfflineNotification)
    onlineManager.setOnline(false)
    await nextTick()
    expect(shownToasts()).toEqual([getText('offlineToastMessage')])
    onlineManager.setOnline(true)
    await nextTick()
    expect(shownToasts()).toEqual([getText('onlineToastMessage')])
    // Back offline before the previous toasts' exit animations have ended.
    onlineManager.setOnline(false)
    await nextTick()
    expect(shownToasts()).toEqual([getText('offlineToastMessage')])
    scope.stop()
  })
})
