/** @file The help panel mounts outside the project view's settings provider and keeps its node's state. */
import { mockProjectNameStore } from '$/providers/openedProjects/projectNames'
import { SuggestionDb } from '$/providers/openedProjects/suggestionDatabase'
import {
  makeArgument,
  makeModuleMethod,
} from '$/providers/openedProjects/suggestionDatabase/mockSuggestion'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import ComponentHelp from '@/components/ComponentHelp.vue'
import { HELP_ARGUMENTS_EXPANDED_STORAGE_KEY } from '@/components/ComponentHelp/expanded'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { computed } from 'vue'

const projectNames = mockProjectNameStore('local', 'Mock_Project')
const entries = new SuggestionDb()

vi.mock('$/components/WithCurrentProject.vue', () => ({
  useCurrentProject: () => ({
    suggestionDb: computed(() => ({ entries, groups: [] })),
    projectNames: computed(() => projectNames),
  }),
}))

beforeEach(() => localStorage.removeItem(HELP_ARGUMENTS_EXPANDED_STORAGE_KEY))
afterEach(() => {
  document.body.innerHTML = ''
})

test('mounts without a settings provider; the toggle expands the node and the choice is kept', async () => {
  const entry = makeModuleMethod('local.Mock_Project.work', {
    args: [
      makeArgument('self', 'local.Mock_Project'),
      makeArgument('count', 'Standard.Base.Data.Numbers.Integer'),
    ],
    documentation: 'Does the work.',
  })
  entries.set(1, entry)
  const { wrapper } = await mountWithProviders(ComponentHelp, { props: { selectedEntry: 1 } })
  expect(wrapper.find('.DocsSignature').exists()).toBe(true)
  expect(wrapper.findAll('.DocsSignature .param')).toHaveLength(1)
  await wrapper.find('.DocsSignature .toggle').trigger('click')
  expect(wrapper.findAll('.DocsSignature .param')).toHaveLength(0)
  expect(wrapper.findAll('.DocsSignature .row')).toHaveLength(1)
  expect(localStorage.getItem(HELP_ARGUMENTS_EXPANDED_STORAGE_KEY)).toBe('true')
})
