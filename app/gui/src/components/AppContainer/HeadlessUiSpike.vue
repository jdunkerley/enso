<script setup lang="ts">
/**
 * @file The Reka UI spike for #76: a Vue {@link DropdownMenu} mounted in the app container, beside the
 * user bar, behind the `enableHeadlessUiSpike` feature flag.
 *
 * It exists to prove, in the running app rather than in isolation, that a Reka primitive styled
 * with the dashboard's `variants.ts` gets focus management, Escape and keyboard navigation right
 * next to react-aria, whose own overlays and global listeners are live on the same page
 * (`integration-test/dashboard/headlessUiSpike.spec.ts`). It is not a user-facing feature and goes
 * away once the `DropdownMenu` primitive has a real mount site.
 *
 * #78 added a Vue `Popover` beside it, to compare it in a real browser against the React user menu's
 * popover next to it; since #83 the user menu is a Vue `Popover` itself.
 */
import Popover from '$/components/Dialog/Popover.vue'
import DropdownMenu from '$/components/Menu/DropdownMenu.vue'
import MenuItem from '$/components/Menu/MenuItem.vue'
import MenuSeparator from '$/components/Menu/MenuSeparator.vue'
import { TEXT_STYLE } from '$/components/Text/variants'
import { ref } from 'vue'

const selected = ref<string>()

const triggerClasses = TEXT_STYLE({
  variant: 'body',
  className:
    'rounded-full border-0.5 border-primary/20 px-3 hover:bg-primary/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary',
})
</script>

<template>
  <div class="HeadlessUiSpike" data-testid="headless-ui-spike">
    <DropdownMenu testId="headless-ui-spike-menu" placement="bottom-end">
      <template #trigger>
        <button type="button" :class="triggerClasses" data-testid="headless-ui-spike-trigger">
          Reka spike
        </button>
      </template>
      <MenuItem testId="headless-ui-spike-item-alpha" @select="selected = 'Alpha'">Alpha</MenuItem>
      <MenuItem testId="headless-ui-spike-item-beta" @select="selected = 'Beta'">Beta</MenuItem>
      <MenuItem isDisabled testId="headless-ui-spike-item-disabled">Unavailable</MenuItem>
      <MenuSeparator />
      <MenuItem testId="headless-ui-spike-item-gamma" @select="selected = 'Gamma'">Gamma</MenuItem>
    </DropdownMenu>
    <Popover testId="headless-ui-spike-popover" size="xxsmall" placement="bottom-end">
      <template #trigger>
        <button
          type="button"
          :class="triggerClasses"
          data-testid="headless-ui-spike-popover-trigger"
        >
          Reka popover
        </button>
      </template>
      <span :class="TEXT_STYLE({ variant: 'body' })">Popover</span>
    </Popover>
    <output data-testid="headless-ui-spike-selection" :class="TEXT_STYLE({ variant: 'body' })">
      {{ selected ?? '' }}
    </output>
  </div>
</template>

<style scoped>
.HeadlessUiSpike {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
}
</style>
