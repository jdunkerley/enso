<script setup lang="ts">
/**
 * @file One toast of `ToastHost.vue`.
 *
 * Its timing is driven by CSS animations, so that it pauses exactly when its progress bar does:
 * the auto-close timer is the progress bar's shrink animation, and it runs only after the toast has
 * slid in, while neither the pointer is over the toast nor the window has lost focus. A dismissed
 * toast slides out, collapses its height, and then asks to be removed.
 */
import type { Toast } from '$/providers/toasts'
import { useEventListener } from '@vueuse/core'
import { computed, onMounted, ref, useTemplateRef, watch } from 'vue'

const { toast } = defineProps<{ toast: Toast }>()
const emit = defineEmits<{ close: []; removed: [] }>()

/** How long a closed toast takes to collapse its height, in milliseconds. */
const COLLAPSE_MS = 300

const root = useTemplateRef('root')
const phase = ref<'enter' | 'shown' | 'exit'>('enter')
const isRunning = ref(false)

const isControlled = computed(
  () => (toast.progress != null && toast.progress !== 0) || toast.autoClose === false,
)
const progress = computed(() => toast.progress ?? 0)
const isProgressHidden = computed(
  () => toast.hideProgressBar || (isControlled.value && progress.value === 0),
)
const isComplete = computed(() => typeof progress.value === 'number' && progress.value >= 1)

const progressStyle = computed(() => ({
  animationDuration: toast.autoClose === false ? undefined : `${toast.autoClose}ms`,
  animationPlayState: isRunning.value ? 'running' : 'paused',
  opacity: isProgressHidden.value ? 0 : 1,
  ...(isControlled.value && typeof progress.value === 'number' ?
    { transform: `scaleX(${progress.value})` }
  : {}),
}))

const pause = () => (isRunning.value = false)
const play = () => (isRunning.value = true)

onMounted(() => {
  if (!document.hasFocus()) pause()
})
useEventListener(window, 'focus', play)
useEventListener(window, 'blur', pause)

function onMouseEnter() {
  if (toast.autoClose !== false) pause()
}
function onMouseLeave() {
  if (toast.autoClose !== false) play()
}

function onAnimationEnd(event: AnimationEvent) {
  if (event.target !== root.value) return
  if (phase.value === 'enter') {
    phase.value = 'shown'
    play()
  } else if (phase.value === 'exit') {
    collapse()
  }
}

function onProgressEnd() {
  if (toast.isIn) emit('close')
}

/** Shrink the (already hidden) toast to nothing, so that the toasts below it move up smoothly. */
function collapse() {
  const element = root.value
  if (element == null) return emit('removed')
  const { scrollHeight, style } = element
  requestAnimationFrame(() => {
    style.minHeight = 'initial'
    style.height = `${scrollHeight}px`
    style.transition = `all ${COLLAPSE_MS}ms`
    requestAnimationFrame(() => {
      style.height = '0'
      style.padding = '0'
      style.margin = '0'
      setTimeout(() => emit('removed'), COLLAPSE_MS)
    })
  })
}

watch(
  () => toast.isIn,
  (isIn) => {
    if (!isIn) phase.value = 'exit'
  },
  { immediate: true },
)

const ICON_PATHS = {
  info: 'M12 0a12 12 0 1012 12A12.013 12.013 0 0012 0zm.25 5a1.5 1.5 0 11-1.5 1.5 1.5 1.5 0 011.5-1.5zm2.25 13.5h-4a1 1 0 010-2h.75a.25.25 0 00.25-.25v-4.5a.25.25 0 00-.25-.25h-.75a1 1 0 010-2h1a2 2 0 012 2v4.75a.25.25 0 00.25.25h.75a1 1 0 110 2z',
  warning:
    'M23.32 17.191L15.438 2.184C14.728.833 13.416 0 11.996 0c-1.42 0-2.733.833-3.443 2.184L.533 17.448a4.744 4.744 0 000 4.368C1.243 23.167 2.555 24 3.975 24h16.05C22.22 24 24 22.044 24 19.632c0-.904-.251-1.746-.68-2.44zm-9.622 1.46c0 1.033-.724 1.823-1.698 1.823s-1.698-.79-1.698-1.822v-.043c0-1.028.724-1.822 1.698-1.822s1.698.79 1.698 1.822v.043zm.039-12.285l-.84 8.06c-.057.581-.408.943-.897.943-.49 0-.84-.367-.896-.942l-.84-8.065c-.057-.624.25-1.095.779-1.095h1.91c.528.005.84.476.784 1.1z',
  success:
    'M12 0a12 12 0 1012 12A12.014 12.014 0 0012 0zm6.927 8.2l-6.845 9.289a1.011 1.011 0 01-1.43.188l-4.888-3.908a1 1 0 111.25-1.562l4.076 3.261 6.227-8.451a1 1 0 111.61 1.183z',
  error:
    'M11.983 0a12.206 12.206 0 00-8.51 3.653A11.8 11.8 0 000 12.207 11.779 11.779 0 0011.8 24h.214A12.111 12.111 0 0024 11.791 11.766 11.766 0 0011.983 0zM10.5 16.542a1.476 1.476 0 011.449-1.53h.027a1.527 1.527 0 011.523 1.47 1.475 1.475 0 01-1.449 1.53h-.027a1.529 1.529 0 01-1.523-1.47zM11 12.5v-6a1 1 0 012 0v6a1 1 0 11-2 0z',
}

const iconPath = computed(() => (toast.type === 'default' ? undefined : ICON_PATHS[toast.type]))
</script>

<template>
  <div
    :id="String(toast.id)"
    ref="root"
    class="Toast rounded-2xl bg-selected-frame text-sm leading-cozy backdrop-blur-default"
    :class="{
      closeOnClick: toast.closeOnClick,
      animate: phase !== 'shown',
      [`slideIn-${toast.position}`]: phase === 'enter',
      [`slideOut-${toast.position}`]: phase === 'exit',
    }"
    data-testid="toast"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
    @click="toast.closeOnClick && emit('close')"
    @animationend="onAnimationEnd"
  >
    <div :role="toast.isIn ? 'alert' : undefined" class="body">
      <div v-if="toast.isLoading" class="icon">
        <div class="spinner" />
      </div>
      <div v-else-if="iconPath != null" class="icon animateIcon">
        <svg viewBox="0 0 24 24" width="100%" height="100%" :class="`icon-${toast.type}`">
          <path :d="iconPath" />
        </svg>
      </div>
      <div>
        <template v-if="typeof toast.content === 'string'">{{ toast.content }}</template>
        <component :is="toast.content.component" v-else v-bind="toast.content.props" />
      </div>
    </div>
    <button
      v-if="toast.closeButton"
      class="closeButton"
      type="button"
      aria-label="close"
      @click.stop="emit('close')"
    >
      <svg aria-hidden="true" viewBox="0 0 14 16">
        <path
          fill-rule="evenodd"
          d="M7.71 8.23l3.75 3.75-1.48 1.48-3.75-3.75-3.75 3.75L1 11.98l3.75-3.75L1 4.48 2.48 3l3.75 3.75L9.98 3l1.48 1.48-3.75 3.75z"
        />
      </svg>
    </button>
    <div
      :key="isControlled ? 'progress' : `progress-${toast.revision}`"
      role="progressbar"
      :aria-hidden="isProgressHidden ? 'true' : 'false'"
      aria-label="notification timer"
      class="progressBar"
      :class="[isControlled ? 'controlled' : 'animated', `progress-${toast.type}`]"
      :style="progressStyle"
      @animationend.self="!isControlled && onProgressEnd()"
      @transitionend.self="isControlled && isComplete && onProgressEnd()"
    />
  </div>
</template>

<style scoped>
.Toast {
  position: relative;
  min-height: 64px;
  box-sizing: border-box;
  margin-bottom: 1rem;
  padding: 8px;
  box-shadow:
    0 1px 10px 0 rgba(0, 0, 0, 0.1),
    0 2px 15px 0 rgba(0, 0, 0, 0.05);
  display: flex;
  justify-content: space-between;
  max-height: 800px;
  overflow: hidden;
  font-family: var(--font-family);
  color: #757575;
  cursor: default;
  direction: ltr;
  /* Keeps the progress bar inside the rounded corners in WebKit. */
  z-index: 0;

  &.closeOnClick {
    cursor: pointer;
  }
}

@media only screen and (max-width: 480px) {
  .Toast {
    margin-bottom: 0;
  }
}

.body {
  margin: auto 0;
  flex: 1 1 auto;
  padding: 6px;
  display: flex;
  align-items: center;

  & > div:last-child {
    word-break: break-word;
    flex: 1;
  }
}

.icon {
  margin-inline-end: 10px;
  width: 20px;
  flex-shrink: 0;
  display: flex;
}

.icon-info {
  fill: #3498db;
}
.icon-success {
  fill: var(--color-accent);
}
.icon-warning {
  fill: #f1c40f;
}
.icon-error {
  fill: var(--color-danger);
}

.spinner {
  width: 20px;
  height: 20px;
  box-sizing: border-box;
  border: 2px solid;
  border-radius: 100%;
  border-color: #e0e0e0;
  border-right-color: #616161;
  animation: toast-spin 0.65s linear infinite;
}

.animate {
  animation-fill-mode: both;
  animation-duration: 0.7s;
}

.animateIcon {
  animation-fill-mode: both;
  animation-duration: 0.3s;
  animation-name: toast-zoom-in;
}

.slideIn-top-center {
  animation-name: toast-slide-in-down;
}
.slideOut-top-center {
  animation-name: toast-slide-out-up;
}
.slideIn-bottom-right {
  animation-name: toast-slide-in-right;
}
.slideOut-bottom-right {
  animation-name: toast-slide-out-right;
}

.closeButton {
  color: #000;
  background: transparent;
  outline: none;
  border: none;
  padding: 0;
  cursor: pointer;
  opacity: 0.3;
  transition: 0.3s ease;
  align-self: flex-start;

  & > svg {
    fill: currentColor;
    height: 16px;
    width: 14px;
  }

  &:hover,
  &:focus {
    opacity: 1;
  }
}

.progressBar {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 5px;
  z-index: 9999;
  opacity: 0.7;
  transform-origin: left;

  &.animated {
    animation: toast-track-progress linear 1 forwards;
  }
  &.controlled {
    transition: transform 0.2s;
  }
}

.progress-default {
  background: linear-gradient(to right, #4cd964, #5ac8fa, #007aff, #34aadc, #5856d6, #ff2d55);
}
.progress-info {
  background: #3498db;
}
.progress-success {
  background: #07bc0c;
}
.progress-warning {
  background: #f1c40f;
}
.progress-error {
  background: #e74c3c;
}

@keyframes toast-track-progress {
  0% {
    transform: scaleX(1);
  }
  100% {
    transform: scaleX(0);
  }
}

@keyframes toast-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

@keyframes toast-zoom-in {
  from {
    opacity: 0;
    transform: scale3d(0.3, 0.3, 0.3);
  }
  50% {
    opacity: 1;
  }
}

@keyframes toast-slide-in-down {
  from {
    transform: translate3d(0, -110%, 0);
    visibility: visible;
  }
  to {
    transform: translate3d(0, 0, 0);
  }
}

@keyframes toast-slide-out-up {
  from {
    transform: translate3d(0, 0, 0);
  }
  to {
    visibility: hidden;
    transform: translate3d(0, -500px, 0);
  }
}

@keyframes toast-slide-in-right {
  from {
    transform: translate3d(110%, 0, 0);
    visibility: visible;
  }
  to {
    transform: translate3d(0, 0, 0);
  }
}

@keyframes toast-slide-out-right {
  from {
    transform: translate3d(0, 0, 0);
  }
  to {
    visibility: hidden;
    transform: translate3d(110%, 0, 0);
  }
}
</style>
