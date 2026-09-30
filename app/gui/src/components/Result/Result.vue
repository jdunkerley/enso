<script setup lang="ts">
/**
 * @file The result of an operation (success, error, info, loading), with a title, a subtitle and
 * any content: the Vue counterpart of the React `#/components/Result`.
 *
 * `status` may also be `'custom'`, with the `status` slot supplying the icon; the React one takes
 * an element there. `icon` replaces the status's `icons.svg` icon; `false` hides the icon.
 */
import Icon from '$/components/Icon/Icon.vue'
import {
  RESULT_STATUS_STYLES,
  RESULT_STYLES,
  type ResultStatus,
} from '$/components/Result/variants'
import Loader from '$/components/Spinner/Loader.vue'
import Heading from '$/components/Text/Heading.vue'
import Text from '$/components/Text/Text.vue'
import type { VariantProps } from '$/utils/style/tailwindVariants'
import type { Icon as IconName } from '@/util/iconMetadata/iconName'
import { computed } from 'vue'

type ResultVariants = VariantProps<typeof RESULT_STYLES>

const {
  status = 'success',
  title,
  subtitle,
  // `undefined`, not the `false` Vue casts an absent boolean prop to: `false` hides the icon.
  icon = undefined,
  // `undefined`, not the `false` Vue casts an absent boolean prop to, so the default applies.
  centered = undefined,
  testId,
  class: className,
} = defineProps<{
  status?: ResultStatus | 'custom' | undefined
  title?: string | undefined
  subtitle?: string | undefined
  icon?: IconName | false | undefined
  centered?: ResultVariants['centered']
  testId?: string | undefined
  class?: string | undefined
}>()

const styles = computed(() => RESULT_STYLES({ centered }))
const statusStyle = computed(() => (status === 'custom' ? null : RESULT_STATUS_STYLES[status]))
</script>

<template>
  <section :class="styles.base({ className })" :data-testid="testId">
    <template v-if="icon !== false">
      <div
        v-if="statusStyle != null"
        :class="styles.statusIcon({ className: statusStyle.bgClassName })"
      >
        <Loader v-if="statusStyle.icon === 'loader'" minHeight="h8" />
        <!-- No whitespace around the "i": it would be rendered, and shift the glyph. -->
        <!-- eslint-disable-next-line vue/multiline-html-element-content-newline -->
        <Text
          v-else-if="statusStyle.icon === 'info'"
          variant="custom"
          class="pb-0.5 text-xl leading-[0]"
          aria-hidden="true"
        >
          i
        </Text>
        <Icon
          v-else
          :icon="icon ?? statusStyle.icon"
          :class="styles.icon({ className: statusStyle.colorClassName })"
        />
      </div>
      <slot v-else name="status" />
    </template>

    <slot name="title">
      <Heading v-if="title != null" :level="2" :class="styles.title()" variant="subtitle">
        {{ title }}
      </Heading>
    </slot>

    <slot name="subtitle">
      <Text
        v-if="subtitle != null"
        elementType="p"
        :class="styles.subtitle()"
        balance
        variant="body"
      >
        {{ subtitle }}
      </Text>
    </slot>

    <div v-if="$slots.default" :class="styles.content()"><slot /></div>
  </section>
</template>
