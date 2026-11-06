/* eslint-disable vue/one-component-per-file -- a kept-alive project view and another tab, as in `MiddlePanel.vue` */
import { useToasts } from '$/providers/toasts'
import { useGraphEditorToasts } from '@/components/GraphEditor/toasts'
import { mount } from '@vue/test-utils'
import { ObservableV2 } from 'lib0/observable'
import { afterEach, expect, test } from 'vitest'
import { defineComponent, h, KeepAlive, nextTick, ref } from 'vue'

const STARTUP = 'Initializing the project. This can take up to one minute.'

/** The text of the toasts on screen (not leaving). */
function shown(): string[] {
  return useToasts()
    .toasts.value.filter((toast) => toast.isIn)
    .map((toast) => String(toast.content))
}

afterEach(() => {
  const toasts = useToasts()
  toasts.dismiss()
  for (const toast of toasts.toasts.value) toasts.remove(toast.id)
})

/** A project store with what the toasts listen to; `complete` settles its first execution. */
function fakeProject() {
  let complete!: () => void
  const firstExecution = new Promise<void>((resolve) => (complete = resolve))
  const executionContext = new ObservableV2<{
    executionComplete(): void
    executionFailed(message: string): void
    executionStatus(diagnostics: { kind: string; message: string }[]): void
  }>()
  const lsRpcConnection = { on: () => () => {}, client: { onError: () => {} } }
  const project = { firstExecution, executionContext, lsRpcConnection }
  return { project, executionContext, complete }
}

/**
 * Mount the toasts in a project view kept alive, as `MiddlePanel.vue` keeps each tab. `visible`
 * switches to another tab and back.
 */
function mountProjectView(project: ReturnType<typeof fakeProject>['project']) {
  const visible = ref(true)
  const ProjectView = defineComponent({
    name: 'ProjectView',
    setup() {
      useGraphEditorToasts(project as unknown as Parameters<typeof useGraphEditorToasts>[0])
      return () => h('div')
    },
  })
  const OtherTab = defineComponent({ name: 'OtherTab', setup: () => () => h('div') })
  mount(
    defineComponent({
      setup: () => () => h(KeepAlive, () => h(visible.value ? ProjectView : OtherTab)),
    }),
  )
  return visible
}

test('the start-up toast goes when the first execution completes', async () => {
  const { project, complete } = fakeProject()
  mountProjectView(project)
  expect(shown()).toEqual([STARTUP])
  complete()
  await project.firstExecution
  expect(shown()).toEqual([])
})

test('a first execution that fails replaces the start-up toast with why (#600)', async () => {
  const { project, executionContext } = fakeProject()
  mountProjectView(project)
  const libraryError =
    'Package containing the module Standard.Base.Main could not be loaded: The package download has failed: Server responded with: [java.net.ConnectException].'
  executionContext.emit('executionStatus', [[{ kind: 'Error', message: libraryError }]])
  executionContext.emit('executionFailed', ['NoSuchElementException'])
  await nextTick()
  expect(shown()).toEqual([`The project could not be started: ${libraryError}`])
})

test('without an error diagnostic, the failure message is shown', async () => {
  const { project, executionContext } = fakeProject()
  mountProjectView(project)
  executionContext.emit('executionStatus', [[{ kind: 'Warning', message: 'unused' }]])
  executionContext.emit('executionFailed', ['Boom'])
  await nextTick()
  expect(shown()).toEqual(['The project could not be started: Boom'])
})

test('a later failure is reported as before', async () => {
  const { project, executionContext, complete } = fakeProject()
  mountProjectView(project)
  complete()
  await project.firstExecution
  executionContext.emit('executionFailed', ['Boom'])
  expect(shown()).toEqual(['Execution Failed: "Boom"'])
})

test('the start-up toast shows only while its project is the visible tab (#600)', async () => {
  const { project, complete } = fakeProject()
  const visible = mountProjectView(project)
  expect(shown()).toEqual([STARTUP])
  visible.value = false
  await nextTick()
  expect(shown()).toEqual([])
  visible.value = true
  await nextTick()
  expect(shown()).toEqual([STARTUP])
  // Completed while hidden: nothing comes back.
  visible.value = false
  await nextTick()
  complete()
  await project.firstExecution
  visible.value = true
  await nextTick()
  expect(shown()).toEqual([])
})

test('a start-up failure in a hidden tab is shown when the tab is', async () => {
  const { project, executionContext } = fakeProject()
  const visible = mountProjectView(project)
  visible.value = false
  await nextTick()
  executionContext.emit('executionFailed', ['Boom'])
  await nextTick()
  expect(shown()).toEqual([])
  visible.value = true
  await nextTick()
  expect(shown()).toEqual(['The project could not be started: Boom'])
})

test('a start-up failure hides with its tab, and goes once the project executes', async () => {
  const { project, executionContext } = fakeProject()
  const visible = mountProjectView(project)
  executionContext.emit('executionFailed', ['Boom'])
  await nextTick()
  expect(shown()).toEqual(['The project could not be started: Boom'])
  visible.value = false
  await nextTick()
  expect(shown()).toEqual([])
  visible.value = true
  await nextTick()
  expect(shown()).toEqual(['The project could not be started: Boom'])
  executionContext.emit('executionComplete', [])
  expect(shown()).toEqual([])
})
