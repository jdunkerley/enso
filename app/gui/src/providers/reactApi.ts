/**
 * @file What the React dashboard still hands to the Vue app container: moving assets between
 * categories, which the category buttons do when assets are dropped on them. Goes when
 * transferring between categories is ported (the second half of #90).
 */
import type { TransferBetweenCategoriesFunction } from '#/layouts/Drive/Categories'
import { createContextStore } from '@/providers'
import { identity } from '@vueuse/core'

/** The React functions the Vue app container uses. */
export interface ReactApi {
  transferBetweenCategories: TransferBetweenCategoriesFunction
}

export const [provideReactApi, useReactApi] = createContextStore('reactApi', identity<ReactApi>)
