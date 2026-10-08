/**
 * @file The right panel's Schedule tab (#183): what it shows for each selection, the calendar and
 * its keyboard use, a day's executions with their logs and deletion, and the new-execution dialog.
 */
import ConfirmDeleteModal from '$/components/AlertDialog/ConfirmDeleteModal.vue'
import type { Category } from '$/providers/category'
import { useModals } from '$/providers/modals'
import LocalStorage from '$/utils/LocalStorage'
import { mountWithProviders } from '$/utils/testing/mountWithProviders'
import { getLocalTimeZone, today, toZoned } from '@internationalized/date'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@vue/test-utils'
import {
  AssetType,
  ProjectExecutionId,
  ProjectId,
  ProjectSessionId,
  type AnyAsset,
  type ProjectExecution,
} from 'enso-common/src/services/Backend'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { reactive, ref } from 'vue'
import { z } from 'zod'
import ProjectExecutionsCalendar from '../ProjectExecutionsCalendar.vue'

const backend = vi.hoisted(() => ({
  type: 'remote',
  listProjectExecutions: vi.fn(),
  deleteProjectExecution: vi.fn(),
  createProjectExecution: vi.fn(),
  listAssetVersionTags: vi.fn(),
}))
vi.mock('$/providers/backends', () => ({ useBackends: () => ({ remoteBackend: backend }) }))
const openProjectLogTab = vi.fn()
vi.mock('$/providers/container', () => ({ useContainerData: () => ({ openProjectLogTab }) }))

const PROJECT_ID = ProjectId('project-1')
const project = { type: AssetType.project, id: PROJECT_ID, title: 'Customers' } as AnyAsset

const category = ref<Category>({ type: 'cloud' })
const asset = ref<AnyAsset>()
const rightPanel = reactive({
  context: {
    get category() {
      return category.value
    },
  },
  focusedAsset: asset,
})

const zone = getLocalTimeZone()
const todayDate = today(zone)

/** An execution repeating daily at the given local hour, started a month ago. */
function daily(id: string, hour: number, withSession = false): ProjectExecution {
  const start = toZoned(todayDate.subtract({ months: 1 }), zone).set({ hour })
  const todayRun = toZoned(todayDate, zone).set({ hour })
  return {
    executionId: ProjectExecutionId(id),
    projectId: PROJECT_ID,
    repeat: { type: 'daily' },
    startDate: start.toAbsoluteString(),
    endDate: null,
    timeZone: zone,
    maxDurationMinutes: 60,
    parallelMode: 'restart',
    tag: undefined,
    nextExecution: todayRun.toAbsoluteString(),
    ...(withSession ?
      {
        projectSessions: [
          {
            projectId: PROJECT_ID,
            projectSessionId: ProjectSessionId('session-today'),
            createdAt: todayRun.toAbsoluteString(),
          },
        ],
      }
    : {}),
  } as unknown as ProjectExecution
}

// `App.vue` registers it in the app.
beforeAll(() => {
  if (!LocalStorage.getAllRegisteredKeys().includes('preferredTimeZone')) {
    LocalStorage.registerKey('preferredTimeZone', { schema: z.string() })
  }
})

let portalRoot: HTMLElement
beforeEach(() => {
  portalRoot = document.createElement('div')
  portalRoot.id = 'enso-portal-root'
  document.body.appendChild(portalRoot)
  category.value = { type: 'cloud' }
  asset.value = project
  backend.listProjectExecutions.mockResolvedValue([daily('morning', 9, true), daily('evening', 18)])
  backend.deleteProjectExecution.mockResolvedValue(undefined)
  backend.createProjectExecution.mockResolvedValue({})
  backend.listAssetVersionTags.mockResolvedValue(['release'])
  openProjectLogTab.mockReset()
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
})
afterEach(() => {
  vi.unstubAllGlobals()
  portalRoot.remove()
  vi.clearAllMocks()
  useModals().closeAll()
})

async function renderTab() {
  const mounted = await mountWithProviders(ProjectExecutionsCalendar, { stores: { rightPanel } })
  await flushPromises()
  return mounted
}

const text = () => document.body.textContent ?? ''
const cell = (date: { toString(): string }) =>
  document.querySelector<HTMLElement>(`[role="button"][data-value="${date.toString()}"]`)!
const buttonNamed = (name: string) =>
  [...document.querySelectorAll<HTMLElement>('button')].find(
    (button) => button.getAttribute('aria-label') === name || button.textContent?.trim() === name,
  )

describe('placeholders', () => {
  test('outside the cloud', async () => {
    category.value = { type: 'local' }
    const { wrapper } = await renderTab()
    expect(wrapper.text()).toContain('The execution calendar is not available for local projects.')
    expect(backend.listProjectExecutions).not.toHaveBeenCalled()
  })

  test('with nothing selected, or another asset than a project', async () => {
    asset.value = undefined
    const { wrapper } = await renderTab()
    expect(wrapper.text()).toContain('Select a single project to view its execution calendar.')
    asset.value = { ...project, type: AssetType.file } as AnyAsset
    await flushPromises()
    expect(wrapper.text()).toContain('Select a single project to view its execution calendar.')
  })
})

describe('the calendar', () => {
  test("shows this month's executions, named as react-aria named them", async () => {
    await renderTab()
    expect(backend.listProjectExecutions).toHaveBeenCalledWith(
      PROJECT_ID,
      'Customers',
      todayDate.year,
      todayDate.month,
    )
    const application = document.querySelector('[role="application"]')!
    const month = application.getAttribute('aria-label')!
    expect(month).toMatch(new RegExp(String(todayDate.year)))
    expect(document.querySelector('[role="grid"]')!.getAttribute('aria-label')).toBe(month)
    expect(application.querySelector('h2.sr-only')?.textContent).toBe(month)
    // Today is chosen, and every day of the month has the two daily executions.
    expect(cell(todayDate).getAttribute('aria-label')).toMatch(/^Today, .* selected$/)
    expect(cell(todayDate).textContent).toContain('2')
    expect(cell(todayDate).hasAttribute('data-selected')).toBe(true)
    // The header row is empty.
    expect(document.querySelector('thead')!.textContent?.trim()).toBe('')
  })

  test('days of other months are disabled', async () => {
    await renderTab()
    const outside = document.querySelector<HTMLElement>('[role="button"][data-outside-view]')
    if (outside) expect(outside.hasAttribute('data-disabled')).toBe(true)
    expect(cell(todayDate).hasAttribute('data-disabled')).toBe(false)
  })

  test('the arrow keys move between days and Enter chooses one', async () => {
    await renderTab()
    const user = userEvent.setup()
    cell(todayDate).focus()
    const other = todayDate.day > 1 ? todayDate.subtract({ days: 1 }) : todayDate.add({ days: 1 })
    await user.keyboard(other.compare(todayDate) < 0 ? '{ArrowLeft}' : '{ArrowRight}')
    await user.keyboard('{Enter}')
    await flushPromises()
    expect(text()).toContain(`Project sessions on ${other.toString()}`)
  })

  test('"Next" shows the next month, and asks for its executions', async () => {
    await renderTab()
    const user = userEvent.setup()
    await user.click(buttonNamed('Next')!)
    await flushPromises()
    const next = todayDate.add({ months: 1 })
    expect(backend.listProjectExecutions).toHaveBeenCalledWith(
      PROJECT_ID,
      'Customers',
      next.year,
      next.month,
    )
  })
})

describe("the chosen day's executions", () => {
  test('one that started a session shows its logs first; the other offers its actions', async () => {
    await renderTab()
    expect(text()).toContain(`Project sessions on ${todayDate.toString()}`)
    const logs = buttonNamed('Show Logs')!
    expect(logs).toBeDefined()
    expect(text().indexOf('9:00 am')).toBeLessThan(text().indexOf('6:00 pm'))
    await userEvent.setup().click(logs)
    expect(openProjectLogTab).toHaveBeenCalledWith(ProjectSessionId('session-today'), 'Customers')
  })

  test('"Delete" asks first, then deletes the execution', async () => {
    await renderTab()
    const user = userEvent.setup()
    await user.click(buttonNamed('Actions')!)
    await flushPromises()
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((i) =>
      i.textContent?.includes('Delete'),
    )!
    await user.click(item)
    await flushPromises()
    const [entry] = useModals().stack.value
    expect(entry?.component).toBe(ConfirmDeleteModal)
    expect(entry?.props).toMatchObject({
      actionText: 'delete this project execution schedule (canceling all future repeats)',
    })
    await (entry!.props as { onConfirm: () => Promise<unknown> }).onConfirm()
    expect(backend.deleteProjectExecution).toHaveBeenCalledWith(
      ProjectExecutionId('evening'),
      'Customers',
    )
  })

  test('a day without executions says how to make one', async () => {
    backend.listProjectExecutions.mockResolvedValue([])
    await renderTab()
    expect(text()).toContain('Create an execution schedule using the button above.')
  })
})

describe('a new execution', () => {
  test('the dialog schedules the project daily from the chosen day by default', async () => {
    await renderTab()
    const user = userEvent.setup()
    await user.click(buttonNamed('New Schedule')!)
    await flushPromises()
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
    expect(dialog.textContent).toContain('New Schedule')
    expect(dialog.textContent).toContain('Repeats at')
    await user.click(
      [...dialog.querySelectorAll<HTMLElement>('button')].find(
        (b) => b.textContent?.trim() === 'Submit',
      )!,
    )
    await flushPromises()
    expect(backend.createProjectExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        repeat: { type: 'daily' },
        parallelMode: 'restart',
        maxDurationMinutes: 60,
        endDate: null,
      }),
      'Customers',
    )
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
  })
})
