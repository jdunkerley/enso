/** @file An entry of the drive's context menu (`ContextMenu.vue`). */
import type { TEXT_STYLE } from '$/components/Text/variants'
import type { PaywallFeatureName } from '$/composables/paywall'
import type { DashboardBindingKey } from '$/configurations/inputBindings'
import type { VariantProps } from '$/utils/style/tailwindVariants'
import type { Icon } from '@/util/iconMetadata/iconName'

/** An entry of the drive's context menu. */
export interface ContextMenuEntry {
  readonly action: DashboardBindingKey
  readonly doAction: () => void
  /** Overrides the action's name. */
  readonly label?: string | undefined
  readonly icon?: Icon | undefined
  readonly tooltip?: string | null | undefined
  readonly isDisabled?: boolean | undefined
  readonly color?: VariantProps<typeof TEXT_STYLE>['color']
  /** Locked behind the paywall: the entry opens the paywall dialog for its `feature`. */
  readonly isUnderPaywall?: boolean | undefined
  readonly feature?: PaywallFeatureName | undefined
}
