<script setup lang="ts">
/**
 * @file Vue's `<Suspense>` with a `Loader.vue` as the default fallback: the Vue counterpart of the
 * React `#/components/Suspense`, which wraps `React.Suspense` the same way.
 *
 * It is not called `Suspense`, so that it cannot shadow Vue's built-in `<Suspense>` in a template.
 * The content is the default slot; `fallback` replaces the loader, and `loaderProps` configures it.
 * Like the built-in, it waits for async `setup()`s (a top-level `await` in `<script setup>`) in its
 * content.
 */
import Loader from '$/components/Spinner/Loader.vue'
import type { ComponentProps } from 'vue-component-type-helpers'

const { loaderProps } = defineProps<{
  loaderProps?: ComponentProps<typeof Loader> | undefined
}>()
</script>

<template>
  <Suspense>
    <slot />
    <template #fallback>
      <slot name="fallback">
        <Loader minHeight="h24" size="medium" v-bind="loaderProps" />
      </slot>
    </template>
  </Suspense>
</template>
