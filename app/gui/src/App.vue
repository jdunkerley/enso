<script lang="ts">
import LocalStorage from '$/utils/LocalStorage'
import * as z from 'zod'

declare module '$/utils/LocalStorage' {
  interface LocalStorageData {
    readonly preferredTimeZone: string
    readonly loginRedirect: string
  }
}
LocalStorage.registerKey('preferredTimeZone', { schema: z.string() })
LocalStorage.registerKey('loginRedirect', { isUserSpecific: true, schema: z.string() })
</script>

<script setup lang="ts">
import { useVersionCheckerEnabled } from '$/cloud/versionChecker/versionChecker'
import { openAboutModal, useAboutModal } from '$/components/AboutModal/aboutModal'
import ErrorBoundary from '$/components/ErrorBoundary/ErrorBoundary.vue'
import ToastHost from '$/components/Toast/ToastHost.vue'
import {
  useClearSelectionOnClick,
  useDevNavigate,
  useThemeClass,
} from '$/composables/appShellEffects'
import { useOfflineNotification } from '$/composables/offlineNotification'
import { useCodeFontRootClasses } from '$/providers/codeFont'
import { appOpenCloseCallback } from '$/utils/analytics'
import '@/assets/base.css'
import { appBindings } from '@/bindings'
import TooltipDisplayer from '@/components/TooltipDisplayer.vue'
import { useEvent, useMounted } from '@/composables/events'
import { initializeActions, registerHandlers } from '@/providers/action'
import { provideAppClassSet } from '@/providers/appClass'
import { provideGlobalEventRegistry } from '@/providers/globalEventRegistry'
import { provideInteractionHandler } from '@/providers/interactionHandler'
import { provideBubblingKeyboard, provideKeyboard } from '@/providers/keyboard'
import { provideTooltipRegistry } from '@/providers/tooltipRegistry'
import { registerAutoBlurHandler, registerGlobalBlurHandler } from '@/util/autoBlur'
import * as objects from 'enso-common/src/utilities/data/object'
import { Platform, platform } from 'enso-common/src/utilities/detect'
import { defineAsyncComponent, ref, watch } from 'vue'
import LoadingScreen from './components/LoadingScreen.vue'

const classSet = provideAppClassSet()
useCodeFontRootClasses()
const appTooltips = provideTooltipRegistry()

const globalEvents = provideGlobalEventRegistry()
provideKeyboard(globalEvents)
provideBubblingKeyboard(globalEvents)
const interaction = provideInteractionHandler()
const actions = initializeActions()
registerAutoBlurHandler()
registerGlobalBlurHandler()

const actionHandlers = registerHandlers(
  {
    'app.cancel': { action: () => interaction.cancelAll() },
    'app.close': { action: () => window.close() },
  },
  actions,
)

const bindingsHandlers = appBindings.handler(
  objects.mapEntries(appBindings.bindings, (actionName) => actionHandlers[actionName].action),
)

const { globalEventRegistry } = globalEvents
useEvent(globalEventRegistry, 'keydown', (event) => bindingsHandlers(event), { capture: true })

useEvent(globalEventRegistry, 'pointerdown', (e) => interaction.handlePointerDown(e), {
  capture: true,
})

const platformClass = {
  [Platform.windows]: 'onWindows',
  [Platform.macOS]: 'onMacOs',
  [Platform.linux]: 'onLinux',
  [Platform.windowsPhone]: 'onWindowsPhone',
  [Platform.iPhoneOS]: 'onIPhoneOs',
  [Platform.android]: 'onAndroid',
  [Platform.unknown]: undefined,
}[platform()]

useMounted(appOpenCloseCallback)

useThemeClass()
useClearSelectionOnClick()
useDevNavigate()
useOfflineNotification()

// The "About Enso" dialog, opened by the app menu here, and by the user and info menus. Loaded on
// first use, so that it keeps the dialog (and Reka) out of the initial chunk, and kept mounted
// from then on, so that it can play its exit animation.
const AboutModal = defineAsyncComponent(() => import('$/components/AboutModal/AboutModal.vue'))
const about = useAboutModal()
const aboutMounted = ref(false)
watch(about.isOpen, (isOpen) => {
  if (isOpen) aboutMounted.value = true
})
window.api?.menu.setMenuItemHandler('about', openAboutModal)

// The "new version available" dialog, mounted on every page, only while the check is enabled (the desktop app), and loaded then: it brings the dialog
// and the stepper. It is cloud-area code (decision 6b), imported directly until the registries
// exist.
const VersionChecker = defineAsyncComponent(
  () => import('$/cloud/versionChecker/VersionChecker.vue'),
)
const versionCheckerEnabled = useVersionCheckerEnabled()
</script>

<template>
  <div :class="['App', platformClass, ...classSet.keys()]">
    <!-- A route that fails to render shows the error display (its `ErrorBoundary`) rather than
    nothing; navigating elsewhere resets it. -->
    <RouterView v-slot="{ Component, route }">
      <template v-if="Component">
        <ToastHost />
        <AboutModal
          v-if="aboutMounted"
          v-model:open="about.isOpen.value"
          :opener="about.opener.value"
        />
        <VersionChecker v-if="versionCheckerEnabled" />
        <ErrorBoundary onlyRenderErrors :resetKeys="[route.path]">
          <component :is="Component" />
        </ErrorBoundary>
        <div id="floatingLayer" />
        <TooltipDisplayer :registry="appTooltips" />
      </template>
      <LoadingScreen v-else />
    </RouterView>
  </div>
</template>

<style>
.App {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  /* This is to ensure the tooltips and floating elements will be over all other app elements */
  isolation: isolate;
}

#floatingLayer {
  position: absolute;
  color: var(--color-text);
  font-family: var(--font-sans);
  dominant-baseline: central;
  font-weight: 500;
  font-size: 11.5px;
  line-height: 20px;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  top: 0;
  left: 0;
  /* The size isn't important, except it must be non-zero for `floating-ui` to calculate the scale factor. */
  width: 1px;
  height: 1px;
  contain: layout size style;
  pointer-events: none;
  > * {
    pointer-events: auto;
  }
}

.mainView {
  flex-grow: 1;
  min-height: 0;
  display: flex;
  flex-direction: row;
}

.mousePointer {
  position: absolute;
  width: 20px;
  height: 20px;
  pointer-events: none;
  background-color: red;
}
</style>
