<script setup lang="ts">
/**
 * @file A coloured link with an icon. A plain click on a link to a page of this app navigates
 * through the router; focus shows the `focus-ring`, on keyboard focus only.
 */
import Icon from '$/components/Icon/Icon.vue'
import type { Icon as IconName } from '@/util/iconMetadata/iconName'
import { useClientNavigation } from './clientNavigation'

const { to, icon, text } = defineProps<{
  to: string
  icon: IconName
  text: string
}>()

const navigate = useClientNavigation()
</script>

<template>
  <a
    :href="to"
    rel="noopener noreferrer"
    class="flex items-center gap-auth-link rounded-full px-auth-link-x py-auth-link-y text-center text-xs font-bold text-blue-500 transition-all duration-auth hover:text-blue-700 focus:text-blue-700 focus-visible:focus-ring"
    @click="navigate"
  >
    <Icon :icon="icon" />{{ text }}
  </a>
</template>
