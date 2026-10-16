/**
 * A Perforce folder workspace hosted by a paired runtime (the route an SSH workspace takes through
 * orcad) must show the Perforce panel on the client, fed by the host's perforce.* RPC methods.
 *
 * Needs a working p4 client workspace on this machine; the host runs p4 there:
 *   ORCA_P4_TEST_WORKSPACE=/path/to/p4/client ORCA_BACKGROUND_LAUNCH=1 pnpm exec playwright test \
 *     tests/e2e/paired-client-perforce-panel.spec.ts \
 *     --config tests/playwright.config.ts --project electron-headless --workers=1
 */
import { existsSync } from 'node:fs'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import {
  createRuntimeDesktopPairingOffer,
  launchPairedElectronClient,
  type PairedElectronClient
} from './helpers/paired-electron-client'
import { createRestartSession } from './helpers/orca-restart'

const workspace = process.env.ORCA_P4_TEST_WORKSPACE ?? ''

async function callRuntime<TResult>(
  page: Page,
  environmentId: string,
  method: string,
  params: unknown
): Promise<TResult> {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test-only RPC result shape.
  return page.evaluate(
    async ({ environmentId, method, params }) => {
      const response = await window.api.runtimeEnvironments.call({
        selector: environmentId,
        method,
        params
      })
      if (!response.ok) {
        throw new Error(`${response.error.code}: ${response.error.message}`)
      }
      return response.result
    },
    { environmentId, method, params }
  ) as Promise<TResult>
}

test('a paired client shows the Perforce panel for a host-served Perforce folder', async (// oxlint-disable-next-line no-empty-pattern -- This test owns its host launch.
{}, testInfo) => {
  test.skip(!workspace || !existsSync(workspace), 'Set ORCA_P4_TEST_WORKSPACE to a p4 client root')
  test.setTimeout(240_000)
  const session = createRestartSession(testInfo)
  let host: ElectronApplication | null = null
  let client: PairedElectronClient | null = null
  try {
    const launched = await session.launch()
    host = launched.app
    client = await launchPairedElectronClient(
      await createRuntimeDesktopPairingOffer(launched.page),
      testInfo,
      'perforce-panel'
    )
    const added = await callRuntime<{ repo: { id: string } }>(
      client.page,
      client.environmentId,
      'repo.add',
      { path: workspace, kind: 'folder' }
    )
    const findWorktreeId = (): Promise<string | null> =>
      client!.page.evaluate(
        (repoId) =>
          window.__store
            ?.getState()
            .allWorktrees()
            .find((worktree) => worktree.repoId === repoId)?.id ?? null,
        added.repo.id
      )
    await expect
      .poll(findWorktreeId, { timeout: 60_000, message: 'Client never saw the host folder' })
      .not.toBeNull()
    const worktreeId = (await findWorktreeId()) ?? ''

    // No P4 settings anywhere: the host's environment has no P4CONFIG, so this proves the
    // workspace's .p4config is discovered by default, as on an orcad-served SSH host.
    const status = await callRuntime<{ info: { client: string } }>(
      client.page,
      client.environmentId,
      'perforce.status',
      { worktree: `id:${worktreeId}` }
    )
    expect(status.info.client.length).toBeGreaterThan(0)

    await client.page.evaluate((id) => {
      const state = window.__store?.getState()
      state?.setActiveWorktree(id)
      state?.setRightSidebarTab('source-control')
      state?.setRightSidebarOpen(true)
    }, worktreeId)

    await expect(
      client.page.getByRole('button', { name: 'Get latest revisions (p4 sync)' })
    ).toBeVisible({ timeout: 60_000 })
    await client.page.screenshot({ path: testInfo.outputPath('paired-perforce-panel.png') })
  } finally {
    if (client) {
      await client.dispose()
    }
    if (host) {
      await session.close(host)
    }
    await session.dispose()
  }
})
