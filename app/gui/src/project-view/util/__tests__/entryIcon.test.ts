import { SuggestionKind } from '$/providers/openedProjects/suggestionDatabase/entry'
import { DEFAULT_ICON, entryIcon } from '@/util/entryIcon'
import { expect, test } from 'vitest'

test.each([
  [{ iconName: 'preparation' as const, kind: SuggestionKind.Method }, 'preparation'],
  [{ kind: SuggestionKind.Module }, 'collection'],
  [{ kind: SuggestionKind.Local }, 'local_scope'],
  [{ kind: SuggestionKind.Method }, DEFAULT_ICON],
  [{ kind: SuggestionKind.Constructor }, 'enso_logo'],
])('%o → %s', (entry, icon) => {
  expect(entryIcon(entry)).toBe(icon)
})
