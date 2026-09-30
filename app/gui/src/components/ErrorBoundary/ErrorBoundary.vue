<script setup lang="ts">
/**
 * @file Catches errors thrown while rendering (or in the lifecycle hooks and watchers) of its
 * content, reports them to Sentry, and shows a fallback instead: the Vue counterpart of the React
 * `#/components/ErrorBoundary`, built on `onErrorCaptured`.
 *
 * The fallback is `ErrorDisplay.vue`, or the `fallback` slot, which receives `{ error, reset }`.
 * Resetting re-mounts the content; so does a change to any of `resetKeys`.
 *
 * Unlike the React one it does not reset failed queries itself: `@tanstack/vue-query` has no
 * `QueryErrorResetBoundary`. A caller whose content failed on a query refetches it from `@reset`.
 */
import * as sentry from '@sentry/vue'
import { onErrorCaptured, ref, shallowRef, watch } from 'vue'
import ErrorDisplay from './ErrorDisplay.vue'

const { resetKeys, title, subtitle } = defineProps<{
  /** Reset the boundary when any of these change. */
  resetKeys?: readonly unknown[] | undefined
  title?: string | undefined
  subtitle?: string | undefined
}>()

const emit = defineEmits<{
  error: [error: unknown, info: string]
  reset: []
}>()

/** The captured error, boxed so that a thrown `undefined` still counts. */
const caught = shallowRef<{ error: unknown }>()
/** Bumped on reset, to re-mount the content from scratch. */
const generation = ref(0)

onErrorCaptured((error, _instance, info) => {
  sentry.captureException(error, { extra: { info } })
  caught.value = { error }
  emit('error', error, info)
  // Handled here: do not propagate to outer boundaries or the app's error handler.
  return false
})

function reset() {
  caught.value = undefined
  generation.value += 1
  emit('reset')
}

watch(
  () => resetKeys,
  (next, previous) => {
    const changed =
      next?.length !== previous?.length || (next ?? []).some((key, i) => key !== previous?.[i])
    if (changed && caught.value != null) reset()
  },
)
</script>

<template>
  <slot v-if="caught != null" name="fallback" :error="caught.error" :reset="reset">
    <ErrorDisplay :error="caught.error" :title="title" :subtitle="subtitle" @reset="reset" />
  </slot>
  <!-- A fragment keyed by the generation, so a reset re-creates the content. -->
  <template v-else>
    <div :key="generation" class="contents"><slot /></div>
  </template>
</template>
