import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import { getActiveWorktreeContext } from './helpers/markdown-editor-fixture'

type DefinitionFixture = {
  directory: string
  packageDirectory: string
  entryPath: string
}

async function createDefinitionFixture(rootPath: string): Promise<DefinitionFixture> {
  const slug = `definition-${randomUUID().slice(0, 8)}`
  const directory = path.join(rootPath, slug)
  const packageDirectory = path.join(rootPath, 'node_modules', `orca-e2e-${slug}`)
  await mkdir(path.join(directory, 'lib'), { recursive: true })
  await mkdir(path.join(packageDirectory, 'types'), { recursive: true })
  await writeFile(
    path.join(packageDirectory, 'package.json'),
    JSON.stringify({ name: `orca-e2e-${slug}`, types: 'types/index.d.ts' })
  )
  await writeFile(
    path.join(packageDirectory, 'types', 'index.d.ts'),
    '// package declaration\nexport declare function greetFromPackage(name: string): string\n'
  )
  await writeFile(
    path.join(directory, 'lib', 'local.ts'),
    '// local declaration\nexport const localAnswer = 42\n'
  )
  const entryPath = path.join(directory, 'entry.ts')
  await writeFile(
    entryPath,
    [
      `import { greetFromPackage } from 'orca-e2e-${slug}'`,
      "import { localAnswer } from './lib/local'",
      '',
      CALL_LINE,
      ''
    ].join('\n')
  )
  return { directory, packageDirectory, entryPath }
}

async function openTypeScriptFile(
  page: Page,
  worktreeId: string,
  rootPath: string,
  filePath: string
): Promise<void> {
  await page.evaluate(
    ({ filePath, relativePath, worktreeId }) => {
      window.__store!.getState().openFile({
        filePath,
        relativePath,
        worktreeId,
        language: 'typescript',
        mode: 'edit'
      })
    },
    { filePath, relativePath: path.relative(rootPath, filePath), worktreeId }
  )
}

const CALL_LINE = 'greetFromPackage(String(localAnswer))'

/** Cmd/Ctrl-clicks `symbol` on the call line until a tab for `expectedPath` is active. */
async function followDefinition(page: Page, symbol: string, expectedPath: string): Promise<void> {
  const callLine = page.locator('.monaco-editor .view-line').filter({ hasText: CALL_LINE })
  // Why retry: the import prefetch lands shortly after the tab mounts; an early click finds nothing.
  await expect(async () => {
    const box = await callLine.getByText(symbol).last().boundingBox()
    if (!box) {
      throw new Error(`${symbol} is not rendered`)
    }
    await page.mouse.move(box.x + 4, box.y + box.height / 2)
    await page.keyboard.down('ControlOrMeta')
    await page.mouse.down()
    await page.mouse.up()
    await page.keyboard.up('ControlOrMeta')
    await expect(page.locator('.editor-header-path').first()).toContainText(expectedPath, {
      timeout: 1_500
    })
  }).toPass({ timeout: 20_000 })
}

test('Cmd/Ctrl-click follows a TypeScript import into node_modules and into project files', async ({
  orcaPage
}, testInfo) => {
  await waitForSessionReady(orcaPage)
  await waitForActiveWorktree(orcaPage)
  const context = await getActiveWorktreeContext(orcaPage)
  await orcaPage.evaluate(async () => {
    await window.__store!.getState().updateSettings({ experimentalEditorGoToDefinition: true })
  })
  const fixture = await createDefinitionFixture(context.rootPath)
  try {
    await openTypeScriptFile(orcaPage, context.worktreeId, context.rootPath, fixture.entryPath)
    await expect(orcaPage.locator('.monaco-editor .view-line').first()).toBeVisible({
      timeout: 25_000
    })

    const packageEntry = path.relative(
      context.rootPath,
      path.join(fixture.packageDirectory, 'types', 'index.d.ts')
    )
    await followDefinition(orcaPage, 'greetFromPackage', packageEntry)
    await expect(
      orcaPage.locator('.monaco-editor .view-line').filter({ hasText: 'package declaration' })
    ).toBeVisible()
    await testInfo.attach('node-modules-definition', {
      body: await orcaPage.screenshot({ path: testInfo.outputPath('node-modules-definition.png') }),
      contentType: 'image/png'
    })

    await openTypeScriptFile(orcaPage, context.worktreeId, context.rootPath, fixture.entryPath)
    const localModule = path.relative(
      context.rootPath,
      path.join(fixture.directory, 'lib', 'local.ts')
    )
    await followDefinition(orcaPage, 'localAnswer', localModule)
    await expect(
      orcaPage.locator('.monaco-editor .view-line').filter({ hasText: 'local declaration' })
    ).toBeVisible()
  } finally {
    await rm(fixture.directory, { recursive: true, force: true })
    await rm(fixture.packageDirectory, { recursive: true, force: true })
  }
})
