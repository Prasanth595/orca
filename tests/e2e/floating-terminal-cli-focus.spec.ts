/**
 * `orca terminal switch` (the `terminal.focus` RPC with host navigation) on a floating-terminal
 * pane must open the floating panel on that tab and leave the main window's workspace alone.
 * Before the fix it made the floating workspace the main selection and the panel stayed shut.
 *
 * Run:
 *   npx playwright test tests/e2e/floating-terminal-cli-focus.spec.ts \
 *     --config tests/playwright.config.ts --project electron-headless --workers=1
 */
import { RuntimeClient } from '../../src/cli/runtime-client'
import { expect, test } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'

// Why: mirrors FLOATING_TERMINAL_WORKTREE_ID in src/shared/constants.ts.
const FLOATING_WORKTREE_ID = 'global-floating-terminal'
const OPEN_PANEL_SELECTOR = '[data-floating-terminal-panel][aria-hidden="false"]'
const TOGGLE_EVENT = 'orca-toggle-floating-terminal'

type TerminalListResult = {
  terminals: { handle: string; worktreeId: string; tabId: string | null }[]
}

test('focusing a floating terminal from the CLI opens the floating panel, not the main view', async ({
  electronApp,
  orcaPage
}, testInfo) => {
  test.setTimeout(180_000)
  await waitForSessionReady(orcaPage)
  const mainWorktreeId = await waitForActiveWorktree(orcaPage)

  const floatingTabId = await orcaPage.evaluate(
    async ({ worktreeId, toggleEvent }) => {
      const store = window.__store
      if (!store) {
        throw new Error('Store unavailable')
      }
      await store.getState().updateSettings({ floatingTerminalEnabled: true })
      window.dispatchEvent(new Event(toggleEvent))
      return store.getState().createTab(worktreeId).id
    },
    { worktreeId: FLOATING_WORKTREE_ID, toggleEvent: TOGGLE_EVENT }
  )
  await expect(orcaPage.locator(OPEN_PANEL_SELECTOR)).toBeVisible()

  const userDataDir = await electronApp.evaluate(({ app }) => app.getPath('userData'))
  const client = new RuntimeClient(userDataDir, 30_000, null, null)
  let handle: string | null = null
  await expect
    .poll(
      async () => {
        const { result } = await client.call<TerminalListResult>('terminal.list', {})
        handle =
          result.terminals.find(
            (terminal) =>
              terminal.worktreeId === FLOATING_WORKTREE_ID && terminal.tabId === floatingTabId
          )?.handle ?? null
        return handle
      },
      { timeout: 60_000, message: 'the floating terminal never reached the runtime' }
    )
    .not.toBeNull()

  // Close the panel: the user is working in the main window when the CLI call arrives.
  await orcaPage.evaluate(
    (toggleEvent) => window.dispatchEvent(new Event(toggleEvent)),
    TOGGLE_EVENT
  )
  await expect(orcaPage.locator(OPEN_PANEL_SELECTOR)).toHaveCount(0)
  await orcaPage.screenshot({ path: testInfo.outputPath('before-terminal-switch.png') })

  await client.call('terminal.focus', { terminal: handle, navigation: 'host' })

  await expect(orcaPage.locator(OPEN_PANEL_SELECTOR)).toBeVisible()
  await expect
    .poll(() => orcaPage.evaluate(() => window.__store?.getState().activeWorktreeId ?? null))
    .toBe(mainWorktreeId)
  await expect
    .poll(() =>
      orcaPage.evaluate(
        (worktreeId) => window.__store?.getState().activeTabIdByWorktree?.[worktreeId] ?? null,
        FLOATING_WORKTREE_ID
      )
    )
    .toBe(floatingTabId)
  await orcaPage.screenshot({ path: testInfo.outputPath('after-terminal-switch.png') })
})
