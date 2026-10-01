/**
 * @file Whether a {@link Text} is nested in another one. Nested texts drop their line-height
 * compensation, as the React `Text.Group`/`TextProvider` does.
 */
import { createContextStore } from '@/providers'

export const [provideInsideText, injectInsideText] = createContextStore(
  'inside Text',
  () => true as const,
)
