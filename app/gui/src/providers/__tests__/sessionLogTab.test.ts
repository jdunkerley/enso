/**
 * @file The session log tab (Activity → Show Logs): its route, and the tabs saved by earlier
 * versions, whose viewer it replaces.
 */
import LocalStorage from '$/utils/LocalStorage'
import { ProjectId, ProjectSessionId } from 'enso-common/src/services/Backend'
import { describe, expect, test } from 'vitest'
import type { RouteLocation } from 'vue-router'
import { routeFromTab, tabFromRoute, type Tab } from '../container'

const SESSION = ProjectSessionId('localprojectsession-key/enso-language-server-2026-10-19-09-00-00')
const PROJECT = ProjectId('project-%2Fprojects%2FSales')
const FROM = { query: {} } as unknown as RouteLocation

function route(params: Record<string, string>) {
  return { name: 'projectLog', params } as unknown as RouteLocation
}

describe('the session log route', () => {
  test('carries the project, so the session picker can list its sessions', () => {
    const tab: Tab = { type: 'projectLog', id: SESSION, title: 'Sales', projectId: PROJECT }
    const target = routeFromTab(tab, FROM) as { name: string; params: Record<string, string> }
    expect(target).toMatchObject({ name: 'projectLog' })
    expect(tabFromRoute(route(target.params))).toEqual(tab)
  })

  test('opens without a project, as links from before it existed do', () => {
    expect(tabFromRoute(route({ id: SESSION, title: 'Sales', projectId: '' }))).toEqual({
      type: 'projectLog',
      id: SESSION,
      title: 'Sales',
    })
    expect(tabFromRoute(route({ id: SESSION, title: 'Sales' }))).toEqual({
      type: 'projectLog',
      id: SESSION,
      title: 'Sales',
    })
    const tab: Tab = { type: 'projectLog', id: SESSION, title: 'Sales' }
    expect(routeFromTab(tab, FROM)).toMatchObject({ params: { projectId: '' } })
  })
})

describe('saved tabs', () => {
  const schema = LocalStorage.getKeyMetadata('openedTabs').schema

  test('a session log tab saved by the old viewer still loads, and opens the new one', () => {
    const saved = [
      { type: 'settings' },
      // As the old viewer saved it: no project.
      { type: 'projectLog', id: SESSION, title: 'Sales' },
    ]
    const parsed = schema.safeParse(saved)
    expect(parsed.success).toBe(true)
    expect(parsed.data).toEqual(saved)
  })

  test('a new session log tab is saved with its project', () => {
    const saved = [{ type: 'projectLog', id: SESSION, title: 'Sales', projectId: PROJECT }]
    expect(schema.safeParse(saved).data).toEqual(saved)
  })
})
