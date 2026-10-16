import { expect, test } from './helpers/orca-app'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { waitForActivePanePtyId, waitForTerminalOutput } from './helpers/terminal'

const SESSION_ID = 'e2e-claude-move-session'

test('moves a Claude session still on the old account to the selected one', async ({
  orcaPage
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  await ensureTerminalVisible(orcaPage)
  const ptyId = await waitForActivePanePtyId(orcaPage)

  // Two saved accounts with B selected, the way a switch leaves them.
  await orcaPage.evaluate(async () => {
    const account = (id: string, email: string) => ({
      id,
      email,
      managedAuthPath: '',
      managedAuthRuntime: 'host' as const,
      wslDistro: null,
      authMethod: 'subscription-oauth' as const,
      createdAt: 1,
      updatedAt: 1,
      lastAuthenticatedAt: 1
    })
    const settings = await window.api.settings.set({
      claudeManagedAccounts: [
        account('acct-a', 'a@example.test'),
        account('acct-b', 'b@example.test')
      ],
      activeClaudeManagedAccountId: 'acct-b',
      activeClaudeManagedAccountIdsByRuntime: { host: 'acct-b', wsl: {} }
    })
    window.__store?.setState({ settings })
  })

  // The open pane plays a Claude session that started on A and sits idle at its prompt.
  await orcaPage.evaluate(
    ({ ptyId, sessionId }) => {
      const store = window.__store
      if (!store) {
        throw new Error('No store')
      }
      const state = store.getState()
      const tabId = Object.entries(state.ptyIdsByTabId).find(([, ids]) => ids?.includes(ptyId))?.[0]
      const ptyIdsByLeafId = tabId ? state.terminalLayoutsByTabId[tabId]?.ptyIdsByLeafId : null
      const leafId = Object.entries(ptyIdsByLeafId ?? {}).find(([, id]) => id === ptyId)?.[0]
      const tab = Object.values(state.tabsByWorktree)
        .flat()
        .find((candidate) => candidate.id === tabId)
      if (!tabId || !leafId || !tab) {
        throw new Error('Active pane is not bound to a tab')
      }
      const paneKey = `${tabId}:${leafId}`
      const idleSince = Date.now() - 120_000
      store.setState({
        agentStatusByPaneKey: {
          ...state.agentStatusByPaneKey,
          [paneKey]: {
            paneKey,
            tabId,
            worktreeId: tab.worktreeId,
            state: 'done',
            prompt: 'ship it',
            updatedAt: idleSince,
            stateStartedAt: idleSince,
            stateHistory: [],
            agentType: 'claude',
            providerSession: {
              key: 'session_id',
              id: sessionId,
              transcriptPath: `/e2e/claude-profiles/acct-a/home/projects/-e2e/${sessionId}.jsonl`
            }
          }
        }
      })
    },
    { ptyId, sessionId: SESSION_ID }
  )

  // The Claude switcher opens from its row in the status bar's usage panel.
  await orcaPage.getByRole('button', { name: 'Usage', exact: true }).click()
  await orcaPage
    .getByRole('menuitem', { name: /Claude/ })
    .first()
    .click()
  await expect(orcaPage.getByText('1 Claude session is still on the old account.')).toBeVisible()
  await orcaPage.screenshot({ path: testInfo.outputPath('claude-session-move-prompt.png') })
  await orcaPage.getByRole('button', { name: 'Move Session', exact: true }).click()

  // The pane comes back in a new process that resumes the same conversation, and the menu stops
  // counting it.
  await waitForTerminalOutput(orcaPage, "'--resume'", 20_000)
  await expect.poll(() => waitForActivePanePtyId(orcaPage), { timeout: 20_000 }).not.toBe(ptyId)
  await expect(orcaPage.getByText('1 Claude session is still on the old account.')).toHaveCount(0)
  await orcaPage.screenshot({ path: testInfo.outputPath('claude-session-moved.png') })
})
