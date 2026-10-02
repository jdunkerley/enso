/** @file The right panel's Activity tab inside an open project (#176). */
import { expect, test } from 'integration-test/base'

test("Activity tab lists the open project's sessions", async ({ editorPage, localApi }) => {
  localApi.addProjectSession('2026-10-01T10:00:00.000Z')
  localApi.addProjectSession('2026-10-01T11:00:00.000Z')
  const calls = localApi.trackCalls()
  await editorPage.do(async (page) => {
    await page.getByRole('tab', { name: 'Activity' }).click()
    const panel = page.getByTestId('right-panel')
    // Not `exact`: each entry's element holds its date as well ("Session 2on 2026-10-01 …").
    await expect(panel.getByText('Session 2')).toBeVisible()
    await expect(panel.getByText('Session 1')).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Show Logs' })).toHaveCount(2)
    await expect(panel.getByText('Select a single project to view its sessions.')).toBeHidden()
    expect(calls.listProjectSessions).toHaveLength(1)
  })
})
