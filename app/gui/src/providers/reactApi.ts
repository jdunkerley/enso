import type { TransferBetweenCategoriesFunction } from '#/layouts/Drive/Categories'
import { createContextStore } from '@/providers'
import { identity } from '@vueuse/core'

export interface ReactApi {
  startTransition: (action: () => void) => void
  isTransitioning: boolean
  transferBetweenCategories: TransferBetweenCategoriesFunction
}

export const [provideReactApi, useReactApi] = createContextStore('reactApi', identity<ReactApi>)
