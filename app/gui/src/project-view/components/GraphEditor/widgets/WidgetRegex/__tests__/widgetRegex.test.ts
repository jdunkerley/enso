/** @file The unset regex input: a typed pattern is written as `regex '<pattern>'`, in one edit. */
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import { Ast } from '@/util/ast'
import { describe, expect, test, vi } from 'vitest'
import { ref } from 'vue'
import { MutableModule } from 'ydoc-shared/ast'

const edits = vi.hoisted(() => ({ count: 0 }))
vi.mock('$/components/WithCurrentProject.vue', async () => {
  const { MutableModule } = await import('ydoc-shared/ast')
  return {
    useCurrentProject: () => ({
      module: ref({
        edit: <T>(f: (edit: MutableModule) => T) => {
          edits.count++
          return f(MutableModule.Transient())
        },
      }),
    }),
  }
})

/** jsdom has no canvas to measure text with. */
vi.mock('@/util/measurement', () => ({
  getComputedFont: () => '',
  getTextWidthByFont: (text: string) => text.length * 8,
}))

const { default: WidgetRegex } = await import('@/components/GraphEditor/widgets/WidgetRegex.vue')

async function commit(text: string) {
  const updateCallback = vi.fn(() => ({ ok: true }))
  edits.count = 0
  const { wrapper } = await mountWithProviders(WidgetRegex, {
    props: {
      input: { portId: 'port', value: undefined, dynamicConfig: { kind: 'Regex_Input' } },
      updateCallback,
      nesting: 0,
    } as never,
  })
  const input = wrapper.find('input')
  await input.setValue(text)
  await input.trigger('blur')
  return updateCallback as unknown as ReturnType<typeof vi.fn>
}

describe('the unset regex input', () => {
  test('writes `regex` with the escaped pattern in one edit', async () => {
    const update = await commit("a'b.*")
    expect(edits.count).toBe(1)
    expect(update).toHaveBeenCalledTimes(1)
    const { portUpdate } = update.mock.calls[0]![0]
    expect(portUpdate.origin).toBe('port')
    expect((portUpdate.value as Ast.Ast).code()).toBe("regex 'a\\'b.*'")
  })

  test('writes nothing for an empty pattern', async () => {
    const update = await commit('')
    expect(edits.count).toBe(0)
    expect(update).not.toHaveBeenCalled()
  })
})
