/**
 * @file The asset search bar's suggestions: what they are, the ones for `type:`, and the store
 * through which the table (which knows the listed assets, labels and users) gives them to the bar.
 * React kept that store for the window (a zustand store in `AssetSearchBar.tsx`); this one lives as
 * long as the drive.
 */
import type AssetQuery from '$/utils/AssetQuery'
import { createContextStore } from '@/providers'
import { shallowRef, type VNodeChild } from 'vue'

/** A suggested query. */
export interface Suggestion {
  readonly key: string
  readonly render: () => VNodeChild
  readonly addToQuery: (query: AssetQuery) => AssetQuery
  readonly deleteFromQuery: (query: AssetQuery) => AssetQuery
}

export const SUGGESTIONS_FOR_TYPE: readonly Suggestion[] = [
  {
    key: 'type:project',
    render: () => 'type:project',
    addToQuery: (query) => query.add('types', ['project']),
    deleteFromQuery: (query) => query.delete('types', ['project']),
  },
  {
    key: 'type:folder',
    render: () => 'type:folder',
    addToQuery: (query) => query.add('types', ['folder']),
    deleteFromQuery: (query) => query.delete('types', ['folder']),
  },
  {
    key: 'type:file',
    render: () => 'type:file',
    addToQuery: (query) => query.add('types', ['file']),
    deleteFromQuery: (query) => query.delete('types', ['file']),
  },
  {
    key: 'type:secret',
    render: () => 'type:secret',
    addToQuery: (query) => query.add('types', ['secret']),
    deleteFromQuery: (query) => query.delete('types', ['secret']),
  },
  {
    key: 'type:datalink',
    render: () => 'type:datalink',
    addToQuery: (query) => query.add('types', ['datalink']),
    deleteFromQuery: (query) => query.delete('types', ['datalink']),
  },
]

/** See the file comment. */
export const [provideSuggestions, useSuggestions] = createContextStore('driveSuggestions', () => {
  const suggestions = shallowRef<readonly Suggestion[]>([])
  return {
    suggestions,
    /** Replace the suggestions. */
    setSuggestions(value: readonly Suggestion[]) {
      suggestions.value = value
    },
  }
})
