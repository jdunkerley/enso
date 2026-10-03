<script setup lang="ts">
/**
 * @file The bar with the Enso logo at the top right of the pages outside the dashboard (login,
 * registration and the like), which opens the {@link InfoMenu}: the Vue counterpart of the React
 * `#/layouts/InfoBar` (#83). The React `Page` and the Vue authentication pages
 * (`AuthenticationPage.vue`) mount it.
 */
import Button from '$/components/Button/Button.vue'
import Popover from '$/components/Dialog/Popover.vue'
import Icon from '$/components/Icon/Icon.vue'
import { useText } from '$/providers/text'
import InfoMenu from './InfoMenu.vue'

const { getText } = useText()
</script>

<template>
  <div
    class="pointer-events-auto flex h-row shrink-0 cursor-default items-center gap-user-bar rounded-full bg-frame backdrop-blur-default"
  >
    <!-- Named by its trigger, as react-aria's dialog was. -->
    <Popover testId="info-menu" size="xxsmall" :aria-label="getText('openInfoMenu')">
      <template #trigger>
        <Button
          size="custom"
          variant="icon"
          class="flex size-row-h select-none items-center overflow-clip rounded-full"
        >
          <Icon
            icon="enso_logo"
            :alt="getText('openInfoMenu')"
            class="pointer-events-none size-7"
          />
        </Button>
      </template>
      <InfoMenu />
    </Popover>
  </div>
</template>
