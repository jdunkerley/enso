<script setup lang="ts">
/**
 * @file Renders the app's toasts (`$/providers/toasts`): one container per screen position, each
 * listing its toasts oldest first. Mounted once, in `App.vue`.
 *
 * Toasts are 320px wide, top centre by default, sliding in and out, at most three at once, with a
 * close button, a progress bar that pauses on hover and while the window is unfocused, and
 * `role="alert"` on the message. A click in a container never dismisses a dialog
 * (`data-ignore-click-outside`).
 */
import { useToasts, type ToastPosition, type ToastsStore } from '$/providers/toasts'
import { computed } from 'vue'
import ToastItem from './ToastItem.vue'

const { store = useToasts() } = defineProps<{
  /** The store to render; the app's global one by default. */
  store?: ToastsStore
}>()

const POSITIONS: readonly ToastPosition[] = ['top-center', 'bottom-right']

const containers = computed(() =>
  POSITIONS.map((position) => ({
    position,
    toasts: store.toasts.value.filter((toast) => toast.position === position),
  })).filter(({ toasts }) => toasts.length > 0),
)
</script>

<template>
  <!-- The test ID is the integration tests' handle on toasts (a contract kept from before the Vue port, #81). -->
  <div class="ToastHost" data-testid="toast-host">
    <div
      v-for="{ position, toasts } in containers"
      :key="position"
      class="container"
      :class="position"
      data-ignore-click-outside
    >
      <ToastItem
        v-for="toast in toasts"
        :key="toast.id"
        :toast="toast"
        @close="store.dismiss(toast.id)"
        @removed="store.remove(toast.id)"
      />
    </div>
  </div>
</template>

<style scoped>
.container {
  z-index: 9999;
  position: fixed;
  padding: 4px;
  width: 320px;
  box-sizing: border-box;
  color: #fff;

  &.top-center {
    top: 1em;
    left: 50%;
    transform: translateX(-50%);
  }

  &.bottom-right {
    bottom: 1em;
    right: 1em;
  }
}

@media only screen and (max-width: 480px) {
  .container {
    width: 100vw;
    padding: 0;
    left: 0;
    margin: 0;

    &.top-center {
      top: 0;
      left: 0;
      transform: translateX(0);
    }

    &.bottom-right {
      bottom: 0;
      transform: translateX(0);
    }
  }
}
</style>
