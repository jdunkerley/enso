<script setup lang="ts">
/**
 * @file A button, or a link styled as one: the Vue counterpart of the React `#/components/Button`,
 * styled by the same `BUTTON_STYLES`.
 *
 * The props keep the React names (`isDisabled`, `isLoading`, `tooltip`, `icon`, …) so that ports
 * stay mechanical; see the rulings in `docs/superpowers/specs/2026-09-30-react-to-vue-foundations.md`.
 * The differences are Vue's: `class` and `contentClass` instead of `className` and
 * `contentClassName`, slots instead of render props, and the press handler is the `onPress` prop,
 * which `@press="…"` binds. It is a prop rather than an emitted event so that its return value is
 * seen: while a returned promise is pending the button shows its loader and is disabled, as in
 * React.
 *
 * - With `href` it renders an `<a>` (external links open in a new tab), otherwise a `<button>`.
 * - An icon-only button (an `icon` and no default slot) gets a tooltip from `tooltip` or its
 *   `aria-label`. Any button gets one from `tooltip`; `tooltip: false` turns it off. A disabled
 *   button cannot be hovered for an accessible tooltip, so it shows the text as a visual tooltip
 *   instead, as in React.
 * - Inside a `ButtonGroup.vue` it takes the group's shared props, and its place in a joined group.
 */
import { BUTTON_STYLES, type ButtonVariants } from '$/components/Button/variants'
import Icon from '$/components/Icon/Icon.vue'
import type { Placement } from '$/components/placement'
import StatelessSpinner from '$/components/Spinner/StatelessSpinner.vue'
import Tooltip from '$/components/Tooltip/Tooltip.vue'
import { useVisualTooltip } from '$/components/Tooltip/useVisualTooltip'
import VisualTooltipPopup from '$/components/Tooltip/VisualTooltipPopup.vue'
import { isExternalLink } from '$/utils/url'
import type { Icon as IconName } from '@/util/iconMetadata/iconName'
import { computed, onScopeDispose, ref, toValue, useAttrs, useSlots, watch } from 'vue'
import { injectButtonGroup, injectJoinedButton, type ButtonGroupSharedProps } from './buttonGroup'

// The root may be wrapped in a `Tooltip`, so attributes are placed on the button explicitly.
defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    variant?: ButtonVariants['variant']
    size?: ButtonVariants['size']
    rounded?: ButtonVariants['rounded']
    fullWidth?: boolean | undefined
    iconPosition?: ButtonVariants['iconPosition']
    showIconOnHover?: boolean | undefined
    extraClickZone?:
      boolean | 'custom' | 'large' | 'medium' | 'small' | 'xsmall' | 'xxsmall' | undefined
    isActive?: boolean | 'none' | undefined
    isDisabled?: boolean | undefined
    isLoading?: boolean | undefined
    /** `full` replaces the whole content with the loader; `icon` replaces only the icon. */
    loaderPosition?: 'full' | 'icon' | undefined
    hideLoader?: boolean | undefined
    icon?: IconName | undefined
    /** Falls back to `aria-label` for an icon-only button. `false` disables the tooltip. */
    tooltip?: string | false | undefined
    tooltipPlacement?: Placement | undefined
    href?: string | undefined
    type?: 'button' | 'reset' | 'submit' | undefined
    testId?: string | undefined
    class?: string | undefined
    contentClass?: string | undefined
    /** Called on press. While a returned promise is pending, the button shows as loading. */
    onPress?: ((event: MouseEvent) => unknown) | undefined
  }>(),
  {
    // Explicit `undefined`s: Vue casts an absent boolean prop (even `string | false`) to `false`,
    // which would override the `ButtonGroup`'s shared props and the variants' defaults, and turn
    // the tooltip off.
    fullWidth: undefined,
    isActive: undefined,
    showIconOnHover: undefined,
    extraClickZone: undefined,
    isDisabled: undefined,
    isLoading: undefined,
    hideLoader: undefined,
    tooltip: undefined,
  },
)

const attrs = useAttrs()
const slots = useSlots()

const group = injectButtonGroup(true)
const joinedPosition = injectJoinedButton(true)

/** A prop, or the group's value for it when the button does not set it. */
function shared<K extends keyof ButtonGroupSharedProps>(key: K): ButtonGroupSharedProps[K] {
  return props[key] ?? toValue(group)?.[key]
}

const position = computed(() => toValue(joinedPosition))
const isJoined = computed(() => position.value != null)
const resolvedLoaderPosition = computed(() => shared('loaderPosition') ?? 'full')

const implicitlyLoading = ref(false)
const loading = computed(() => shared('isLoading') ?? implicitlyLoading.value)
const disabled = computed(() => shared('isDisabled') ?? loading.value)

const isLink = computed(() => props.href != null)
const hasContent = computed(() => slots.default != null)
const isIconOnly = computed(() => !hasContent.value && (props.icon != null || slots.icon != null))

const tooltipText = computed(() => {
  if (props.tooltip === false) return undefined
  if (props.tooltip != null) return props.tooltip
  const label = attrs['aria-label']
  return isIconOnly.value && typeof label === 'string' ? label : undefined
})
const useVisual = computed(() => tooltipText.value != null && disabled.value)

const styles = computed(() => {
  const variant = shared('variant')
  return BUTTON_STYLES({
    isDisabled: disabled.value,
    isActive: shared('isActive'),
    // `focus-visible:` classes, which only apply while focused anyway; react-aria passes its
    // `isFocused` render prop here.
    isFocused: true,
    loading: loading.value,
    fullWidth: shared('fullWidth'),
    size: shared('size'),
    rounded: shared('rounded'),
    variant,
    iconPosition: shared('iconPosition'),
    showIconOnHover: shared('showIconOnHover'),
    extraClickZone: shared('extraClickZone') ?? variant === 'icon',
    iconOnly: isIconOnly.value,
    isJoined: isJoined.value,
    position: position.value,
  })
})

const showOverlayLoader = computed(
  () => props.hideLoader !== true && loading.value && resolvedLoaderPosition.value === 'full',
)
const shouldDisplayBorder = computed(
  () => isJoined.value && (position.value === 'first' || position.value === 'middle'),
)

const ICON_LOADER_DELAY = 150

// With `loaderPosition: 'icon'` the spinner replaces the icon only after a short delay, so a fast
// action does not flash it.
const iconLoaderVisible = ref(false)
let iconLoaderTimer: ReturnType<typeof setTimeout> | undefined
watch(
  () => loading.value && resolvedLoaderPosition.value === 'icon',
  (loadingIcon) => {
    if (iconLoaderTimer != null) clearTimeout(iconLoaderTimer)
    iconLoaderTimer = undefined
    if (loadingIcon) {
      iconLoaderTimer = setTimeout(() => (iconLoaderVisible.value = true), ICON_LOADER_DELAY)
    } else {
      iconLoaderVisible.value = false
    }
  },
  { immediate: true },
)
onScopeDispose(() => {
  if (iconLoaderTimer != null) clearTimeout(iconLoaderTimer)
})
const showIconLoader = computed(() => props.hideLoader !== true && iconLoaderVisible.value)

const content = ref<HTMLElement>()
const loader = ref<HTMLElement>()

// The full loader fades in, and the content fades out, after the same delay as React's.
watch(
  [showOverlayLoader, loader],
  ([showing, loaderElement], _old, onCleanup) => {
    if (!showing || loaderElement == null) return
    const loaderAnimation = loaderElement.animate?.(
      [{ opacity: 0 }, { opacity: 0, offset: 1 }, { opacity: 1 }],
      { duration: ICON_LOADER_DELAY, easing: 'linear', fill: 'forwards' },
    )
    const contentAnimation = content.value?.animate?.([{ opacity: 1 }, { opacity: 0 }], {
      duration: 0,
      easing: 'linear',
      delay: ICON_LOADER_DELAY,
      fill: 'forwards',
    })
    onCleanup(() => {
      loaderAnimation?.cancel()
      contentAnimation?.cancel()
    })
  },
  { flush: 'post' },
)

function onClick(event: MouseEvent) {
  if (disabled.value) {
    event.preventDefault()
    return
  }
  const result = props.onPress?.(event)
  if (result instanceof Promise) {
    implicitlyLoading.value = true
    void result.finally(() => (implicitlyLoading.value = false))
  }
}

const linkAttrs = computed(() =>
  isLink.value ?
    {
      href: disabled.value ? undefined : props.href,
      rel: 'noopener noreferrer',
      ...(isExternalLink(props.href ?? '') ? { target: '_blank' } : {}),
      role: disabled.value ? 'link' : undefined,
    }
  : { type: props.type ?? 'button', disabled: disabled.value },
)

const {
  isOpen: visualTooltipOpen,
  onTooltipEnter,
  onTooltipLeave,
} = useVisualTooltip(content, {
  isDisabled: () => !useVisual.value,
})
</script>

<template>
  <Tooltip
    :tooltip="tooltipText"
    :isDisabled="useVisual"
    :placement="tooltipPlacement"
    :delay="0"
    :closeDelay="0"
  >
    <component
      :is="isLink ? 'a' : 'button'"
      v-bind="{ ...attrs, ...linkAttrs }"
      :class="styles.base({ className: props.class })"
      :data-testid="testId"
      :aria-disabled="isLink && disabled ? 'true' : undefined"
      :aria-busy="loading ? 'true' : undefined"
      :data-disabled="disabled ? '' : undefined"
      :data-pending="loading ? '' : undefined"
      @click="onClick"
    >
      <span :class="styles.wrapper()">
        <span ref="content" :class="styles.content({ className: contentClass })">
          <!-- React renders these straight into the content box, and wraps them in the extra click
          zone only for an icon-only button; `contents` keeps the wrapper out of the layout. -->
          <span :class="isIconOnly ? styles.extraClickZone() : 'contents'">
            <div v-if="$slots.addonStart" :class="styles.addonStart()">
              <slot name="addonStart" />
            </div>
            <div v-if="showIconLoader" :class="styles.icon()">
              <StatelessSpinner phase="loading-medium" :size="16" />
            </div>
            <Icon v-else-if="icon != null" :icon="icon" :class="styles.icon()" />
            <span v-else-if="$slots.icon" :class="styles.icon()"><slot name="icon" /></span>
            <slot />
            <div v-if="$slots.addonEnd" :class="styles.addonEnd()">
              <slot name="addonEnd" />
            </div>
          </span>
        </span>

        <span v-if="showOverlayLoader" ref="loader" :class="styles.loader()">
          <StatelessSpinner phase="loading-medium" :size="16" />
        </span>

        <VisualTooltipPopup
          v-if="useVisual"
          :target="content"
          :open="visualTooltipOpen"
          :placement="tooltipPlacement ?? 'top'"
          @pointerenter="onTooltipEnter"
          @pointerleave="onTooltipLeave"
        >
          {{ tooltipText }}
        </VisualTooltipPopup>
      </span>

      <div v-if="shouldDisplayBorder" :class="styles.joinSeparator()" />
    </component>
  </Tooltip>
</template>
