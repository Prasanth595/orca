import { copyFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'

const FIXTURES = path.join(__dirname, 'fixtures', 'office')

async function openFixture(page: Page, repoPath: string, name: string): Promise<string> {
  const filePath = path.join(repoPath, name)
  copyFileSync(path.join(FIXTURES, name), filePath)
  await page.evaluate(
    ({ filePath, name }) => {
      const state = window.__store?.getState()
      if (!state?.activeWorktreeId) {
        throw new Error('Missing Office fixture worktree')
      }
      state.openFile({
        filePath,
        relativePath: name,
        worktreeId: state.activeWorktreeId,
        language: 'plaintext',
        mode: 'edit'
      })
    },
    { filePath, name }
  )
  return filePath
}

test('Word, PowerPoint and Excel files open as rendered previews', async ({
  orcaPage,
  seededRepoPath,
  registerPostElectronShutdownCleanup
}, testInfo) => {
  test.setTimeout(90_000)
  const opened: string[] = []
  registerPostElectronShutdownCleanup(async () => {
    for (const filePath of opened) {
      rmSync(filePath, { force: true })
    }
  })

  opened.push(await openFixture(orcaPage, seededRepoPath, 'report.docx'))
  await expect(orcaPage.getByText('Word preview')).toBeVisible()
  await expect(orcaPage.locator('section.docx').first()).toContainText('Orca Office preview')
  await expect(orcaPage.locator('section.docx')).toHaveCount(2)
  await orcaPage.screenshot({ path: testInfo.outputPath('docx.png') })

  opened.push(await openFixture(orcaPage, seededRepoPath, 'deck.pptx'))
  await expect(orcaPage.getByText('PowerPoint preview')).toBeVisible()
  await expect(orcaPage.getByText('PowerPoint slides in the editor')).toBeVisible()
  await orcaPage.screenshot({ path: testInfo.outputPath('pptx.png') })

  opened.push(await openFixture(orcaPage, seededRepoPath, 'engines.xlsx'))
  await expect(orcaPage.getByText('Excel preview')).toBeVisible()
  await expect(orcaPage.getByRole('cell', { name: 'Merlin 1D', exact: true })).toBeVisible()
  await expect(orcaPage.getByRole('cell', { name: '2013-09-29', exact: true })).toBeVisible()
  await orcaPage.screenshot({ path: testInfo.outputPath('xlsx.png') })
  await orcaPage.getByRole('tab', { name: 'Notes' }).click()
  await expect(orcaPage.getByRole('cell', { name: '二枚目のシート', exact: true })).toBeVisible()
})
