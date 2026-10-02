<script setup lang="ts">
/**
 * @file A profile picture, or the default user icon when there is none: the Vue counterpart of the
 * React `#/components/ProfilePicture`, styled by the same `PROFILE_PICTURE_STYLES`.
 */
import Icon from '$/components/Icon/Icon.vue'
import { PROFILE_PICTURE_STYLES } from '$/components/ProfilePicture/variants'
import type { VariantProps } from '$/utils/style/tailwindVariants'
import { computed } from 'vue'

type ProfilePictureVariants = VariantProps<typeof PROFILE_PICTURE_STYLES>

const {
  picture,
  name,
  size,
  rounded,
  class: className,
} = defineProps<{
  /** The picture's URL; without one, the default user icon is shown. */
  picture: string | null | undefined
  /** The user's name: the picture's accessible name. */
  name: string
  size?: ProfilePictureVariants['size']
  rounded?: ProfilePictureVariants['rounded']
  class?: string | undefined
}>()

const classes = computed(() =>
  PROFILE_PICTURE_STYLES({ size, rounded, className, default: picture == null }),
)
</script>

<template>
  <Icon v-if="picture == null" icon="default_user" :class="classes" :alt="name" />
  <img v-else :src="picture" :alt="name" :class="classes" />
</template>
