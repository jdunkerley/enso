/* eslint-disable vue/one-component-per-file -- a kept-alive project view and another tab, as in `MiddlePanel.vue` */
/** @file The toast about a project's unresolved libraries, and its edition switch (#600). */
import { useToasts } from '$/providers/toasts'
import { useUnresolvedLibrariesToast } from '@/components/GraphEditor/editionSwitch'
import UnresolvedLibrariesToast from '@/components/GraphEditor/UnresolvedLibrariesToast.vue'
import { mount } from '@vue/test-utils'
import { Ok } from 'enso-common/src/utilities/data/result'
import { afterEach, expect, test, vi } from 'vitest'
import { defineComponent, h, KeepAlive, nextTick, reactive, ref } from 'vue'
import type { LibraryLoadFailure, response } from 'ydoc-shared/languageServerTypes'

const TABLE: LibraryLoadFailure = {
  library: 'Standard.Table',
  version: '0.0.0-dev',
  kind: 'DownloadFailed',
  message: 'HTTP 502',
}
const EDITION: LibraryLoadFailure = {
  library: null,
  version: '0.0.0-dev',
  kind: 'EditionNotFound',
  message: 'not found',
}
const RESOLVES: response.CheckEditionSwitch = {
  current: '0.0.0-dev',
  target: '2026.1.1-dev',
  resolves: true,
  changes: [{ library: 'Standard.Table', from: '0.0.0-dev', to: '2026.1.1-dev' }],
  stillMissing: [],
}

afterEach(() => {
  const toasts = useToasts()
  toasts.dismiss()
  for (const toast of toasts.toasts.value) toasts.remove(toast.id)
  vi.restoreAllMocks()
})

interface ToastProps {
  failures: readonly LibraryLoadFailure[]
  check: response.CheckEditionSwitch | undefined
  busy: boolean
  onSwitch: () => Promise<void>
}

/** The props of the project's toast on screen, and its type; `undefined` when there is none. */
function shownToast(): (ToastProps & { type: string }) | undefined {
  for (const toast of useToasts().toasts.value) {
    const content = toast.content
    if (!toast.isIn || typeof content !== 'object') continue
    if (content.component !== UnresolvedLibrariesToast) continue
    return { ...(content.props as unknown as ToastProps), type: toast.type }
  }
  return undefined
}

function fakeProject(check: response.CheckEditionSwitch = RESOLVES) {
  const calls: string[] = []
  const project = reactive({
    libraryLoadFailures: [] as readonly LibraryLoadFailure[],
    lsRpcConnection: {
      checkEditionSwitch: vi.fn(async () => Ok(check)),
      setParentEdition: vi.fn(async (edition: string) => {
        calls.push(`setParentEdition ${edition}`)
        return Ok({ needsRestart: true })
      }),
    },
    restart: vi.fn(async () => {
      calls.push('restart')
    }),
  })
  const saveVersion = vi.fn(async (comment: string) => {
    calls.push(`save ${comment}`)
  })
  return { project, calls, saveVersion }
}

/** Mount the toast in a project view kept alive, as `MiddlePanel.vue` keeps each tab. */
function mountProjectView(
  project: ReturnType<typeof fakeProject>['project'],
  saveVersion: (comment: string) => Promise<void>,
) {
  const visible = ref(true)
  const ProjectView = defineComponent({
    name: 'ProjectView',
    setup() {
      useUnresolvedLibrariesToast(project as never, { saveVersion })
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

const settle = () => new Promise((resolve) => setTimeout(resolve))

test('no toast while every library loads', async () => {
  const { project, saveVersion } = fakeProject()
  mountProjectView(project, saveVersion)
  await settle()
  expect(shownToast()).toBeUndefined()
  expect(project.lsRpcConnection.checkEditionSwitch).not.toHaveBeenCalled()
})

test('a failed library shows an error toast, then the switch check', async () => {
  const { project, saveVersion } = fakeProject()
  mountProjectView(project, saveVersion)
  project.libraryLoadFailures = [TABLE]
  await nextTick()
  expect(shownToast()).toMatchObject({ failures: [TABLE], type: 'error' })
  await settle()
  expect(project.lsRpcConnection.checkEditionSwitch).toHaveBeenCalledOnce()
  expect(shownToast()).toMatchObject({ failures: [TABLE], check: RESOLVES, busy: false })
})

test('a missing edition alone is a warning', async () => {
  const { project, saveVersion } = fakeProject()
  mountProjectView(project, saveVersion)
  project.libraryLoadFailures = [EDITION]
  await settle()
  expect(shownToast()).toMatchObject({ type: 'warning', check: RESOLVES })
})

test('Switch and reopen saves a version, writes the edition, then reopens', async () => {
  const { project, calls, saveVersion } = fakeProject()
  mountProjectView(project, saveVersion)
  project.libraryLoadFailures = [TABLE]
  await settle()
  await shownToast()?.onSwitch()
  expect(calls).toEqual([
    'save Before switching edition to 2026.1.1-dev',
    'setParentEdition 2026.1.1-dev',
    'restart',
  ])
})

test('a version that cannot be saved stops the switch', async () => {
  const { project, saveVersion } = fakeProject()
  saveVersion.mockRejectedValueOnce(new Error('index.lock exists'))
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mountProjectView(project, saveVersion)
  project.libraryLoadFailures = [TABLE]
  await settle()
  await shownToast()?.onSwitch()
  expect(project.lsRpcConnection.setParentEdition).not.toHaveBeenCalled()
  expect(project.restart).not.toHaveBeenCalled()
  expect(shownToast()).toMatchObject({ busy: false })
  expect(useToasts().toasts.value.map((toast) => String(toast.content))).toContain(
    'Could not switch the edition: index.lock exists',
  )
})

test('when nothing resolves, nothing is switched', async () => {
  const missing = { ...RESOLVES, resolves: false, stillMissing: ['Standard.Table'] }
  const { project, saveVersion } = fakeProject(missing)
  mountProjectView(project, saveVersion)
  project.libraryLoadFailures = [TABLE]
  await settle()
  await shownToast()?.onSwitch()
  expect(saveVersion).not.toHaveBeenCalled()
  expect(project.lsRpcConnection.setParentEdition).not.toHaveBeenCalled()
})

test('the toast hides with its tab, and one the user closed stays closed', async () => {
  const { project, saveVersion } = fakeProject()
  const visible = mountProjectView(project, saveVersion)
  project.libraryLoadFailures = [TABLE]
  await settle()
  visible.value = false
  await nextTick()
  expect(shownToast()).toBeUndefined()
  visible.value = true
  await nextTick()
  expect(shownToast()).toBeDefined()
  // The user closes it.
  useToasts().dismiss()
  visible.value = false
  await nextTick()
  visible.value = true
  await nextTick()
  expect(shownToast()).toBeUndefined()
  // A new failure shows it again.
  project.libraryLoadFailures = [TABLE, { ...TABLE, library: 'Standard.Base' }]
  await nextTick()
  expect(shownToast()).toBeDefined()
})
