<script setup lang="ts">
/**
 * @file A menu with information about the app, opened from the {@link InfoBar}: the Vue counterpart
 * of the React `#/layouts/InfoMenu` (#83). A popover of buttons, as in React.
 */
import { openAboutModal } from '$/components/AboutModal/aboutModal'
import Icon from '$/components/Icon/Icon.vue'
import MenuEntry from '$/components/MenuEntry/MenuEntry.vue'
import Text from '$/components/Text/Text.vue'
import { LOGIN_PATH } from '$/appUtils'
import { useAuth } from '$/providers/auth'
import { useSession } from '$/providers/session'
import { useText } from '$/providers/text'
import { PRODUCT_NAME } from 'enso-common/src/constants'
import { useRouter } from 'vue-router'

const router = useRouter()
const { signOut } = useSession()
const auth = useAuth()
const { getText } = useText()

function onSignOut() {
  void signOut().then(() => router.push(LOGIN_PATH))
}
</script>

<template>
  <div
    class="mb-2 flex items-center gap-icons overflow-hidden px-menu-entry transition-all duration-user-menu"
  >
    <Icon icon="enso_logo" class="pointer-events-none h-7 w-7 text-primary" />
    <Text>{{ PRODUCT_NAME }}</Text>
  </div>
  <div :aria-label="getText('infoMenuLabel')" class="flex flex-col overflow-hidden">
    <MenuEntry action="aboutThisApp" @press="openAboutModal" />
    <MenuEntry v-if="auth.session" action="signOut" @press="onSignOut" />
  </div>
</template>
