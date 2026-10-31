import { whenReadyOnce } from '$/providers/openedProjects/module/openImportCheck'
import { expect, test } from 'vitest'
import { nextTick, ref } from 'vue'

function setup() {
  const root = ref<string>()
  const loaded = ref(false)
  const typesLoaded = ref(false)
  const runs: string[] = []
  whenReadyOnce(
    () => (loaded.value && typesLoaded.value ? root.value : undefined),
    (value) => runs.push(value),
  )
  return { root, loaded, typesLoaded, runs }
}

test('runs once when the module opens after the database and the declared types', async () => {
  const { root, loaded, typesLoaded, runs } = setup()
  loaded.value = true
  typesLoaded.value = true
  await nextTick()
  expect(runs).toEqual([])
  root.value = 'Main'
  await nextTick()
  expect(runs).toEqual(['Main'])
  root.value = 'Main again'
  await nextTick()
  expect(runs).toEqual(['Main'])
})

test('runs once when the module opens first', async () => {
  const { root, loaded, typesLoaded, runs } = setup()
  root.value = 'Main'
  typesLoaded.value = true
  await nextTick()
  expect(runs).toEqual([])
  loaded.value = true
  await nextTick()
  expect(runs).toEqual(['Main'])
})
