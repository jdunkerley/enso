/**
 * @file Whether a {@link Text} is nested in another one (or in a `TextGroup.vue`). Nested texts
 * drop their line-height compensation.
 */
import { createContextStore } from '@/providers'

export const [provideInsideText, injectInsideText] = createContextStore(
  'inside Text',
  () => true as const,
)
