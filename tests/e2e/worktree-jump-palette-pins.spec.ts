import { writeFile } from 'node:fs/promises'
import { encodePaletteIdentity } from '../../src/renderer/src/lib/palette-match/palette-ranking'
import { expect, test } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

const SEARCH = 'Search chats, terminals, worktrees, settings, and actions...'

test('saves search shortcuts, persists order, enforces five slots and activates numbered shortcuts', async ({
  orcaPage: page,
  electronApp
}, testInfo) => {
  await waitForSessionReady(page)
  await waitForActiveWorktree(page)
  await page.evaluate(() => {
    const store = window.__store!
    const state = store.getState()
    const repo = state.repos[0]!
    const source = state.worktreesByRepo[repo.id]![0]!
    const worktrees = Array.from({ length: 6 }, (_, index) => ({
      ...source,
      id: `pin-workspace-${index}`,
      title: `Shortcut workspace ${index}`,
      displayName: `Shortcut workspace ${index}`,
      isMainWorktree: false,
      branch: `refs/heads/pin-${index}`,
      isArchived: false,
      hostId: 'local' as const
    }))
    store.setState({
      worktreesByRepo: {
        ...state.worktreesByRepo,
        [repo.id]: [...state.worktreesByRepo[repo.id]!, ...worktrees]
      },
      showSleepingWorkspaces: true
    })
    store.getState().openModal('worktree-palette')
  })
  const dialog = page.getByRole('dialog', { name: 'Jump to...' })
  const input = dialog.getByPlaceholder(SEARCH)
  const row = (index: number) =>
    dialog.locator('[data-palette-row]').filter({
      has: page.locator(
        `[cmdk-item][data-value="${encodePaletteIdentity(['worktree', `local|pin-workspace-${index}`])}"]`
      )
    })
  for (let index = 0; index < 5; index++) {
    await input.fill(`Shortcut workspace ${index}`)
    await row(index).getByRole('button', { name: 'Add shortcut', exact: true }).click()
    await expect(dialog).toBeVisible()
  }
  await input.fill('Shortcut workspace 5')
  await row(5).getByRole('button', { name: 'Add shortcut', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Manage shortcuts' })).toContainText('5/5')
  await expect(row(5).getByRole('button', { name: 'Add shortcut', exact: true })).toBeVisible()
  await input.fill('')
  await expect(
    dialog.getByText('Shortcuts', { exact: true }).and(dialog.locator('div'))
  ).toBeVisible()
  await expect(dialog.locator('[cmdk-item]').first()).toContainText('Shortcut workspace 0')
  await expect(row(0)).toHaveCount(1)
  await page.evaluate(() => window.__store!.getState().closeModal())
  await expect(dialog).toBeHidden()
  await page.waitForTimeout(350)
  await page.evaluate(() => window.__store!.getState().openModal('worktree-palette'))
  await expect(dialog.locator('[cmdk-item]').first()).toContainText('Shortcut workspace 0')
  await expect(dialog.locator('[cmdk-item][data-selected="true"]')).toHaveCount(1)
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await page.waitForTimeout(500)
  const cdp = await page.context().newCDPSession(page)
  const capture = await cdp.send('Page.captureScreenshot')
  await writeFile(
    testInfo.outputPath('search-shortcuts-dark.png'),
    Buffer.from(capture.data, 'base64')
  )
  await testInfo.attach('search-shortcuts-dark', {
    body: Buffer.from(capture.data, 'base64'),
    contentType: 'image/png'
  })
  await page.evaluate(() => document.documentElement.classList.remove('dark'))
  await page.waitForTimeout(500)
  const light = await cdp.send('Page.captureScreenshot')
  await writeFile(
    testInfo.outputPath('search-shortcuts-light.png'),
    Buffer.from(light.data, 'base64')
  )
  await testInfo.attach('search-shortcuts-light', {
    body: Buffer.from(light.data, 'base64'),
    contentType: 'image/png'
  })
  await cdp.detach()
  await page.evaluate(() => {
    const store = window.__store!
    store.setState({
      worktreesByRepo: Object.fromEntries(
        Object.entries(store.getState().worktreesByRepo).map(([repoId, worktrees]) => [
          repoId,
          worktrees.filter((worktree) => worktree.id !== 'pin-workspace-1')
        ])
      )
    })
  })
  await expect(row(1)).toHaveCount(0)
  await expect(row(4).getByText('5', { exact: true })).toBeVisible()
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]!.webContents.send('ui:jumpToWorktreeIndex', 1)
  })
  await expect(dialog).toBeVisible()
  // Exercise the native accelerator route that owns Cmd/Ctrl+digits while the palette is open.
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]!.webContents.send('ui:jumpToWorktreeIndex', 4)
  })
  await expect(dialog).toBeHidden()
  await expect(
    page
      .locator('[data-worktree-card-active="primary"]')
      .filter({ hasText: 'Shortcut workspace 4' })
  ).toBeVisible()
  await page.evaluate(() => window.__store!.getState().openModal('worktree-palette'))
  await dialog.getByRole('button', { name: 'Manage shortcuts' }).click()
  await page.getByRole('menuitem', { name: 'Shortcut workspace 1' }).click()
  await expect(dialog.getByRole('button', { name: 'Manage shortcuts' })).toContainText('4/5')
})

test('saves a terminal shortcut, survives a renderer reload, and removes it with the keyboard', async ({
  orcaPage: page
}) => {
  await waitForSessionReady(page)
  await waitForActiveWorktree(page)
  const title = await page.evaluate(() => {
    const state = window.__store!.getState()
    const tab = state.unifiedTabsByWorktree[state.activeWorktreeId!]!.find(
      (entry) => entry.contentType === 'terminal'
    )!
    state.openModal('worktree-palette')
    return tab.customLabel ?? tab.label
  })
  const dialog = page.getByRole('dialog', { name: 'Jump to...' })
  const input = dialog.getByPlaceholder(SEARCH)
  await input.fill(title)
  const row = dialog
    .locator('[data-palette-row]')
    .filter({
      has: page.locator('[cmdk-item][data-value^="13:workspace-tab"]')
    })
    .first()
  await row.getByRole('button', { name: 'Add shortcut', exact: true }).click()
  await input.fill('')
  await expect(
    dialog.getByText('Shortcuts', { exact: true }).and(dialog.locator('div'))
  ).toBeVisible()
  await expect(dialog.locator('[cmdk-item]').first()).toContainText(title)
  await page.reload()
  await waitForSessionReady(page)
  await page.evaluate(() => window.__store!.getState().openModal('worktree-palette'))
  await expect(dialog.locator('[cmdk-item]').first()).toContainText(title)
  const unpin = dialog.getByRole('button', { name: 'Remove shortcut', exact: true })
  await unpin.focus()
  await unpin.press('Enter')
  await expect(dialog).toBeVisible()
  await expect(
    dialog.getByText('Shortcuts', { exact: true }).and(dialog.locator('div'))
  ).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Manage shortcuts' })).toHaveCount(0)
})
