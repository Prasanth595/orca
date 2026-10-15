import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ElectronApplication, Page, TestInfo } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  API_7,
  DESCRIPTION,
  OPS_5,
  WEB_12,
  WEB_14,
  WEB_2,
  WEB_3,
  installPlaneIpcFixture,
  planeFixture
} from './plane-tasks-fixture'

// Media for the PR: every `@plane-media` step writes light and dark PNGs to the gitignored
// validation-screenshots/plane-tasks folder and attaches them to the report.
const MEDIA_DIR = path.join(process.cwd(), 'validation-screenshots', 'plane-tasks')

async function captureMedia(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await test.step(`@plane-media ${name}`, async () => {
    mkdirSync(MEDIA_DIR, { recursive: true })
    const cdp = await page.context().newCDPSession(page)
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate(async (value) => {
        await window.__store?.getState().updateSettings({ theme: value })
      }, theme)
      await page.waitForTimeout(150)
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
      const file = path.join(MEDIA_DIR, `${name}-${theme}.png`)
      writeFileSync(file, Buffer.from(data, 'base64'))
      await testInfo.attach(`${name}-${theme}`, { path: file, contentType: 'image/png' })
    }
    await cdp.detach()
  })
}

// Why after the session is ready: main registers the real `plane:*` handlers during startup,
// and registering a stub first would make that registration throw.
async function stubPlane(electronApp: ElectronApplication, page: Page): Promise<void> {
  await waitForSessionReady(page)
  await installPlaneIpcFixture(electronApp, planeFixture())
  // Feature tips from other areas would otherwise sit over the Plane UI in every screenshot.
  const tip = page.getByRole('button', { name: 'Got it', exact: true })
  await tip.click({ timeout: 5_000 }).catch(() => undefined)
  // The completed-onboarding profile has used the workspace board, so the sidebar shows its
  // one-time relocation hint. Its 12-second timer is slow on a loaded machine; clicking the board
  // button closes it at once, and a second click closes the board again.
  const hint = page.getByText('Workspace board moved to the bottom bar')
  const hintShown = await hint.waitFor({ timeout: 5_000 }).then(
    () => true,
    () => false
  )
  if (hintShown) {
    const board = page.getByRole('button', { name: 'Workspace board', exact: true })
    await board.click()
    await expect(board).toHaveAttribute('aria-pressed', 'true')
    await board.click()
    await expect(board).toHaveAttribute('aria-pressed', 'false')
  }
  await expect(hint).toBeHidden()
}

async function openPlaneTasks(electronApp: ElectronApplication, page: Page): Promise<void> {
  await stubPlane(electronApp, page)
  await waitForActiveWorktree(page)
  await page.setViewportSize({ width: 1500, height: 900 })
  await page.evaluate(async () => {
    const store = window.__store
    const settings = store?.getState().settings
    if (!store || !settings) {
      throw new Error('Store or settings unavailable')
    }
    store.setState({
      settings: {
        ...settings,
        defaultTaskSource: 'plane',
        visibleTaskProviders: ['github', 'plane']
      }
    })
    await store.getState().checkPlaneConnection({ kind: 'local' })
    store.getState().openTaskPage({ taskSource: 'plane' })
  })
  await expect(page.getByRole('list', { name: 'Plane work items' })).toBeVisible()
}

function row(page: Page, identifier: string) {
  return page.getByRole('listitem').filter({ hasText: identifier })
}

test.describe('Plane Tasks', () => {
  test('lists open work items and filters by assignee, project and ID @plane-tasks', async ({
    electronApp,
    orcaPage
  }, testInfo) => {
    await openPlaneTasks(electronApp, orcaPage)
    // Open (backlog, unstarted, started) is the default, so the completed item is hidden.
    for (const visible of [WEB_12, WEB_14, API_7]) {
      await expect(row(orcaPage, visible.identifier)).toBeVisible()
    }
    await expect(row(orcaPage, WEB_3.identifier)).toHaveCount(0)
    await expect(orcaPage.getByRole('button', { name: 'State: Open' })).toBeVisible()
    await captureMedia(orcaPage, testInfo, '01-plane-list')

    await orcaPage.getByRole('combobox', { name: 'Assignee' }).click()
    await orcaPage.getByRole('option', { name: 'Me', exact: true }).click()
    await expect(row(orcaPage, WEB_12.identifier)).toBeVisible()
    await expect(row(orcaPage, WEB_14.identifier)).toHaveCount(0)
    await orcaPage.getByRole('combobox', { name: 'Assignee' }).click()
    await orcaPage.getByRole('option', { name: 'Anyone', exact: true }).click()

    await orcaPage.getByRole('combobox', { name: 'Project' }).click()
    await orcaPage.getByRole('option', { name: 'Backend' }).click()
    await expect(row(orcaPage, API_7.identifier)).toBeVisible()
    await expect(row(orcaPage, WEB_12.identifier)).toHaveCount(0)
    await orcaPage.getByRole('combobox', { name: 'Project' }).click()
    await orcaPage.getByRole('option', { name: 'All in scope' }).click()

    // An ID the list has not loaded opens through the identifier lookup.
    const search = orcaPage.getByRole('textbox', { name: 'Search work items' })
    await search.fill(WEB_2.identifier)
    await search.press('Enter')
    await expect(orcaPage.getByRole('heading', { name: WEB_2.name })).toBeVisible()
  })

  test('shows the detail as text, changes state and comments @plane-tasks', async ({
    electronApp,
    orcaPage
  }, testInfo) => {
    await openPlaneTasks(electronApp, orcaPage)
    await row(orcaPage, WEB_12.identifier)
      .getByRole('button', { name: new RegExp(WEB_12.name) })
      .click()
    const sheet = orcaPage.getByRole('dialog')
    await expect(sheet.getByRole('heading', { name: WEB_12.name })).toBeVisible()
    await expect(sheet.getByText(DESCRIPTION)).toBeVisible()
    await expect(sheet.getByText('Reproduced with a fresh invite.')).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Open in Plane' })).toBeVisible()
    await captureMedia(orcaPage, testInfo, '02-plane-detail')

    await sheet.getByRole('button', { name: 'Change state: In Progress' }).click()
    await orcaPage.getByRole('menuitemradio', { name: 'Done' }).click()
    await expect(sheet.getByRole('button', { name: 'Change state: Done' })).toBeVisible()

    const box = sheet.getByRole('textbox', { name: 'Comment' })
    await box.fill('Fixed by keeping the invite token through the redirect.')
    await sheet.getByRole('button', { name: 'Comment', exact: true }).click()
    await expect(
      sheet.getByText('Fixed by keeping the invite token through the redirect.')
    ).toBeVisible()
    await expect(box).toHaveValue('')
  })

  test('creates a workspace linked to the work item @plane-tasks', async ({
    electronApp,
    orcaPage
  }, testInfo) => {
    await openPlaneTasks(electronApp, orcaPage)
    await row(orcaPage, WEB_12.identifier)
      .getByRole('button', { name: `Create workspace from ${WEB_12.identifier}` })
      .click()
    const composer = orcaPage.getByRole('dialog')
    await expect(composer).toBeVisible()
    await expect(composer.locator('[data-workspace-source-pill="true"]')).toContainText(
      `${WEB_12.identifier} ${WEB_12.name}`
    )
    await captureMedia(orcaPage, testInfo, '03-plane-create-workspace')
    await orcaPage.keyboard.press('Escape')
    await expect(composer).toBeHidden()

    // The detail offers the same action as a labelled button.
    await row(orcaPage, WEB_14.identifier)
      .getByRole('button', { name: new RegExp(WEB_14.name) })
      .click()
    const sheet = orcaPage.getByRole('dialog')
    await expect(sheet.getByRole('heading', { name: WEB_14.name })).toBeVisible()
    await sheet.getByRole('button', { name: 'Create workspace', exact: true }).click()
    await expect(
      orcaPage.getByRole('dialog').locator('[data-workspace-source-pill="true"]')
    ).toContainText(`${WEB_14.identifier} ${WEB_14.name}`)
  })

  test('lists both workspaces in Settings and adds one with the saved token @plane-tasks', async ({
    electronApp,
    orcaPage
  }, testInfo) => {
    await stubPlane(electronApp, orcaPage)
    await orcaPage.evaluate(async () => {
      const state = window.__store?.getState()
      await state?.checkPlaneConnection({ kind: 'local' })
      state?.openSettingsTarget({
        pane: 'integrations',
        repoId: null,
        sectionId: 'integrations-plane'
      })
      state?.openSettingsPage()
    })
    await expect(orcaPage.getByText(/2 workspaces connected\./)).toBeVisible()
    await expect(orcaPage.getByRole('button', { name: 'Remove acme' })).toBeVisible()
    await expect(orcaPage.getByRole('button', { name: 'Remove ops' })).toBeVisible()
    await expect(orcaPage.getByText('Plane Cloud', { exact: true })).toBeVisible()
    await expect(orcaPage.getByText('Self-hosted', { exact: true })).toBeVisible()
    await captureMedia(orcaPage, testInfo, '04-plane-settings')

    await orcaPage.getByRole('button', { name: 'Add workspace' }).click()
    const dialog = orcaPage.getByRole('dialog', { name: 'Add Plane workspaces' })
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText(/Uses the token saved for acme on app\.plane\.so/)).toBeVisible()
    await expect(dialog.getByLabel('Personal access token')).toHaveCount(0)
    await captureMedia(orcaPage, testInfo, '05-plane-add-workspace')
  })

  test('switches between one workspace and All workspaces @plane-tasks', async ({
    electronApp,
    orcaPage
  }, testInfo) => {
    await openPlaneTasks(electronApp, orcaPage)
    const switcher = orcaPage.getByRole('combobox', { name: 'Plane workspace' })
    await expect(switcher).toContainText('acme · Plane Cloud')
    await expect(row(orcaPage, OPS_5.identifier)).toHaveCount(0)

    await switcher.click()
    await orcaPage.getByRole('option', { name: 'All workspaces' }).click()
    // Newest first across both workspaces, each row badged with its workspace.
    await expect(row(orcaPage, OPS_5.identifier)).toContainText('ops')
    await expect(row(orcaPage, WEB_12.identifier)).toContainText('acme')
    await expect(orcaPage.getByRole('listitem').first()).toContainText(OPS_5.identifier)
    await expect(orcaPage.getByRole('combobox', { name: 'Project' })).toBeDisabled()
    await expect(
      orcaPage.getByText('Choose one workspace to filter by project or exact state.')
    ).toBeVisible()
    await captureMedia(orcaPage, testInfo, '06-plane-all-workspaces')

    await switcher.click()
    await orcaPage.getByRole('option', { name: 'ops · plane.example.test' }).click()
    await expect(row(orcaPage, OPS_5.identifier)).toBeVisible()
    await expect(row(orcaPage, WEB_12.identifier)).toHaveCount(0)
    await expect(orcaPage.getByRole('combobox', { name: 'Project' })).toBeEnabled()
  })
})
