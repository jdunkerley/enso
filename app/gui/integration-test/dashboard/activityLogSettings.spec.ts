/**
 * @file The activity log settings tab's paging (#196): a log shorter than the view is fetched a
 * bounded number of times, and a long one still loads further pages as it is scrolled.
 */
import { expect, test, type Page } from 'integration-test/base'

import { Plan, type AuditLogEvent } from 'enso-common/src/services/Backend'

/** The page size the tab asks for: `DEFAULT_GET_LOG_EVENTS_PAGE_SIZE`. */
const PAGE_SIZE = 100
/** How long the short log is watched for further requests. */
const SETTLE_MS = 3_000
/** The most requests a short log may take: its one page, with room for a refetch. */
const MAX_SHORT_LOG_REQUESTS = 2

/** `count` events, each of a known kind, so that the tab shows a row for each. */
function makeEvents(count: number): AuditLogEvent[] {
  return Array.from(
    { length: count },
    (_, i) =>
      ({
        organizationId: 'organization-1',
        userEmail: 'user@example.com',
        timestamp: new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString(),
        lambdaKind: 'GET /organizations/me',
        projectId: null,
        metadata: null,
      }) as unknown as AuditLogEvent,
  )
}

/**
 * Serve `events` from the log endpoint, a page at a time, and record the offset of each `GET`.
 * Registered after the mocked backend, so it takes precedence over it.
 */
async function serveLog(page: Page, events: readonly AuditLogEvent[]) {
  const offsets: number[] = []
  await page.route(
    (url) => url.pathname.endsWith('/log_events'),
    async (route, request) => {
      if (request.method() !== 'GET') return route.fallback()
      const params = new URL(request.url()).searchParams
      const from = Number(params.get('from') ?? 0)
      const pageSize = Number(params.get('page_size') ?? PAGE_SIZE)
      offsets.push(from)
      await route.fulfill({ json: { events: events.slice(from, from + pageSize) } })
    },
  )
  return offsets
}

const logRows = (page: Page) => page.locator('tbody tr').filter({ hasText: 'user@example.com' })

test.use({ setupApi: { cloud: (cloudApi) => cloudApi.setPlan(Plan.team) } })

test('a log shorter than the view takes a bounded number of requests', async ({
  page,
  drivePage,
}) => {
  const offsets = await serveLog(page, makeEvents(3))
  await drivePage.goToCategory
    .cloud()
    .goToPage.settings()
    .goToSettingsTab.activityLog()
    .do(async (thePage) => {
      await expect(logRows(thePage)).toHaveCount(3)
      // Give a fetch loop time to show itself: before #196 this made hundreds of requests.
      await thePage.waitForTimeout(SETTLE_MS)
      await expect(logRows(thePage)).toHaveCount(3)
      expect(offsets.length).toBeGreaterThanOrEqual(1)
      expect(offsets.length).toBeLessThanOrEqual(MAX_SHORT_LOG_REQUESTS)
      expect(new Set(offsets)).toEqual(new Set([0]))
    })
})

test('a long log loads further pages as it is scrolled', async ({ page, drivePage }) => {
  const total = 2 * PAGE_SIZE + 50
  const offsets = await serveLog(page, makeEvents(total))
  await drivePage.goToCategory
    .cloud()
    .goToPage.settings()
    .goToSettingsTab.activityLog()
    .do(async (thePage) => {
      const rows = logRows(thePage)
      await expect(rows).toHaveCount(PAGE_SIZE)
      expect(offsets).toEqual([0])
      // Scroll to the end of the list until every page is in.
      await rows.first().hover()
      await expect(async () => {
        await thePage.mouse.wheel(0, 10_000)
        await expect(rows).toHaveCount(total, { timeout: 1_000 })
      }).toPass()
      // The last page was short: the end of the log, so no further request follows.
      await thePage.mouse.wheel(0, 10_000)
      await thePage.waitForTimeout(1_000)
      expect(offsets).toEqual([0, PAGE_SIZE, 2 * PAGE_SIZE])
    })
})
