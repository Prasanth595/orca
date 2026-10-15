import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { test, expect } from './helpers/orca-app'

const execFileAsync = promisify(execFile)

test.use({ seedTestRepo: false })

// Quote, subexpression and non-ASCII: a path that reached PowerShell as script
// text would be mangled or executed instead of copied.
const FILE_NAME = "o'brien $(exit 7) ü.txt"

// Explorer pastes only a real CF_HDROP; FileNameW alone reads back fine but
// pastes nothing, so prove the copy with the shell's own paste verb.
async function shellPasteInto(folder: string): Promise<void> {
  await execFileAsync(
    path.join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe'
    ),
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '(New-Object -ComObject Shell.Application).NameSpace($env:PASTE_TARGET).Self.InvokeVerb("paste")'
    ],
    { env: { ...process.env, PASTE_TARGET: folder }, windowsHide: true, timeout: 30_000 }
  )
}

test.describe('file explorer Copy on Windows', () => {
  test.skip(process.platform !== 'win32', 'Exercises the Windows CF_HDROP clipboard path')

  test('puts a file Explorer can paste on the clipboard', async ({
    orcaPage: page,
    electronApp,
    registerPostElectronShutdownCleanup
  }) => {
    const folder = await mkdtemp(path.join(os.tmpdir(), 'orca-copy-file-'))
    registerPostElectronShutdownCleanup(() => rm(folder, { recursive: true, force: true }))
    const source = path.join(folder, 'workspace')
    const pasteTarget = path.join(folder, 'paste-target')
    await mkdir(source)
    await mkdir(pasteTarget)
    await writeFile(path.join(source, FILE_NAME), 'copied through the clipboard\n')

    await page.evaluate(async (source) => {
      await window.__store!.getState().addRepoPath(source, 'folder')
    }, source)
    await page.getByRole('option').filter({ hasText: 'workspace' }).click()
    await page
      .locator('[data-orca-explorer-shell]')
      .getByRole('button', { name: FILE_NAME, exact: true })
      .click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Copy', exact: true }).click()

    await expect
      .poll(() =>
        electronApp.evaluate(({ clipboard }) =>
          clipboard.readBuffer('FileNameW').toString('utf16le').replace(/\0+$/, '')
        )
      )
      .toBe(path.join(source, FILE_NAME))
    await expect(page.getByText('Could not copy the file to the clipboard')).toHaveCount(0)

    await shellPasteInto(pasteTarget)
    await expect
      .poll(() => readFile(path.join(pasteTarget, FILE_NAME), 'utf8').catch(() => null))
      .toBe('copied through the clipboard\n')
  })
})
