import { graphBindings } from '@/bindings'
import { initializeActions } from '@/providers/action'
import { withSetup } from '@/util/testing'
import { describe, expect, test } from 'vitest'
import { toValue } from 'vue'

describe('components.tidyUp action', () => {
  test('is registered with the tidy_up icon, "Tidy Up" description and Mod+Shift+L shortcut', () => {
    const actions = withSetup(() => initializeActions())
    const tidyUp = actions['components.tidyUp']
    expect(tidyUp).toBeDefined()
    expect(tidyUp.icon).toBe('tidy_up')
    expect(tidyUp.description).toBe('Tidy Up')
    // A getter: the shortcut follows the user's bindings (#170).
    const shortcut = toValue(tidyUp.shortcut)
    expect(shortcut).toBe(graphBindings.bindings['components.tidyUp'])
    expect(shortcut?.modifiers).toEqual(['Mod', 'Shift'])
    expect(shortcut?.key).toBe('L')
  })
})
