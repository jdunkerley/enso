<script setup lang="ts">
/**
 * @file Catches errors thrown while rendering (or in the lifecycle hooks and watchers) of its
 * content, reports them to Sentry, and shows a fallback instead: the Vue counterpart of the React
 * `#/components/ErrorBoundary`, built on `onErrorCaptured`.
 *
 * The fallback is `ErrorDisplay.vue` (loaded on first use), or the `fallback` slot, which receives
 * `{ error, reset }`.
 * Resetting re-mounts the content; so does a change to any of `resetKeys`.
 *
 * Unlike the React one it does not reset failed queries itself: `@tanstack/vue-query` has no
 * `QueryErrorResetBoundary`. A caller whose content failed on a query refetches it from `@reset`.
 *
 * With `onlyRenderErrors` it catches only what React's boundary catches: an error thrown while
 * setting up or rendering a component. Errors from event handlers, watchers and lifecycle hooks
 * then go on to the app's handler (logged, and reported by Sentry's) and leave the content as it
 * is. The route and tab roots use it so: there, catching an event handler's error would replace a
 * whole working view, the graph editor say, with the error display.
 */
import * as sentry from '@sentry/vue'
import { defineAsyncComponent, onErrorCaptured, ref, shallowRef, watch } from 'vue'

// Loaded on first use: `App.vue` puts a boundary around every route, and the display's `Button`
// and `Result` would otherwise bring Reka into the initial chunk (about 100 KB minified).
const ErrorDisplay = defineAsyncComponent(() => import('./ErrorDisplay.vue'))

const {
  resetKeys,
  title,
  subtitle,
  onlyRenderErrors = false,
} = defineProps<{
  /** Reset the boundary when any of these change. */
  resetKeys?: readonly unknown[] | undefined
  title?: string | undefined
  subtitle?: string | undefined
  /** Catch only errors thrown while setting up or rendering a component; let the rest through. */
  onlyRenderErrors?: boolean | undefined
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
  // Not handled here: on to outer boundaries and the app's error handler.
  if (onlyRenderErrors && !isRenderError(info)) return
  sentry.captureException(error, { extra: { info } })
  caught.value = { error }
  emit('error', error, info)
  // Handled here: do not propagate to outer boundaries or the app's error handler.
  return false
})

/**
 * Whether Vue's `info` for a captured error says it was thrown by a component's `setup` or render
 * function (Vue's `ErrorCodes` 0 and 1). Development builds name the error type; production builds
 * link to its entry in Vue's error reference instead.
 */
function isRenderError(info: string) {
  return (
    info === 'setup function' ||
    info === 'render function' ||
    info.endsWith('/error-reference/#runtime-0') ||
    info.endsWith('/error-reference/#runtime-1')
  )
}

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
