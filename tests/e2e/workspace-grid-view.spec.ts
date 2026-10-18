import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import {
  ensureTerminalVisible,
  getActiveWorktreeId,
  getAllWorktreeIds,
  getStoreState,
  waitForActiveWorktree,
  waitForSessionReady
} from './helpers/store'
import { waitForActiveTerminalManager } from './helpers/terminal'

function gridViewCell(page: Page, worktreeId: string) {
  return page.locator(`[data-workspace-grid-view-cell="${worktreeId}"]`)
}

async function gridViewMembers(page: Page): Promise<string[]> {
  return getStoreState<string[]>(page, 'workspaceGridViewMemberIds')
}

test('shows two workspaces side by side and moves focus between them', async ({ orcaPage }) => {
  test.setTimeout(120_000)
  await waitForSessionReady(orcaPage)
  const originalId = await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)
  await waitForActiveTerminalManager(orcaPage, 30_000)
  const otherId = (await getAllWorktreeIds(orcaPage)).find((id) => id !== originalId)
  expect(otherId, 'the seeded repo provides a secondary worktree').toBeTruthy()
  if (!otherId) {
    return
  }
  await orcaPage.screenshot({ path: test.info().outputPath('single-workspace.png') })

  await orcaPage
    .locator(`[role="option"][data-worktree-id="${otherId}"]`)
    .click({ button: 'right' })
  await orcaPage.getByRole('menuitem', { name: 'Add to Grid View', exact: true }).click()

  await expect.poll(() => gridViewMembers(orcaPage)).toEqual([originalId, otherId])
  expect(await getActiveWorktreeId(orcaPage)).toBe(originalId)
  await expect(orcaPage.locator('[data-workspace-grid-view-cell]')).toHaveCount(2)

  // The secondary worktree was never opened, so its cell offers to open it in place.
  await gridViewCell(orcaPage, otherId).getByRole('button', { name: 'Open Workspace' }).click()
  await expect.poll(() => getActiveWorktreeId(orcaPage), { timeout: 20_000 }).toBe(otherId)
  await expect(gridViewCell(orcaPage, otherId).locator('[data-current="true"]')).toBeVisible()
  await expect(gridViewCell(orcaPage, originalId).locator('[data-current="true"]')).toHaveCount(0)

  // Clicking anywhere in the other cell hands focus back without leaving the grid view.
  await gridViewCell(orcaPage, originalId).locator('[data-workspace-grid-view-cell-header]').click()
  await expect.poll(() => getActiveWorktreeId(orcaPage)).toBe(originalId)
  await expect(
    orcaPage.locator(`[role="option"][data-worktree-id="${originalId}"]`)
  ).toHaveAttribute('aria-current', 'page')
  await expect(orcaPage.locator('[data-workspace-grid-view-cell]')).toHaveCount(2)
  await orcaPage.screenshot({ path: test.info().outputPath('workspace-grid-view.png') })

  await gridViewCell(orcaPage, otherId)
    .getByRole('button', { name: 'Remove from Grid View' })
    .click()
  await expect.poll(() => gridViewMembers(orcaPage)).toEqual([])
  expect(await getActiveWorktreeId(orcaPage)).toBe(originalId)
  await expect(orcaPage.locator('[data-workspace-grid-view-cell]')).toHaveCount(0)
})
