import type { Locator } from '@stablyai/playwright-test'
import type { BrowserEvalResult } from '../../src/shared/runtime-types'
import {
  launchHeadlessPairedRuntimeHost,
  type HeadlessPairedRuntimeHost
} from './helpers/headless-paired-runtime-host'
import { focusMaterializedRemoteBrowserPane } from './helpers/materialized-remote-browser-pane'
import { expect, test } from './helpers/orca-app'
import { findPairedWorktreeId } from './helpers/paired-browser-placement-fixture'
import {
  launchPairedElectronClient,
  type PairedElectronClient
} from './helpers/paired-electron-client'
import { startRemoteGrabFixture } from './helpers/remote-browser-grab-fixture'
import { expectRemoteBrowserFrameFreshness } from './helpers/remote-browser-frame-freshness'

async function hostEval(host: HeadlessPairedRuntimeHost, page: string, expression: string) {
  return (await host.client.call<BrowserEvalResult>('browser.eval', { page, expression })).result
    .result
}

async function elementPoint(
  host: HeadlessPairedRuntimeHost,
  page: string,
  selector: string,
  frame: Locator
) {
  const point: unknown = JSON.parse(
    await hostEval(
      host,
      page,
      `(() => {
        const rect = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
        return { x: (rect.x + rect.width / 2) / innerWidth, y: (rect.y + rect.height / 2) / innerHeight };
      })()`
    )
  )
  if (
    !point ||
    typeof point !== 'object' ||
    !('x' in point) ||
    !('y' in point) ||
    typeof point.x !== 'number' ||
    typeof point.y !== 'number'
  ) {
    throw new Error('Fixture element has no point')
  }
  const bounds = await frame.boundingBox()
  if (!bounds) {
    throw new Error('Remote frame has no bounds')
  }
  return { x: bounds.x + bounds.width * point.x, y: bounds.y + bounds.height * point.y }
}

async function elementAppearance(host: HeadlessPairedRuntimeHost, page: string, selector: string) {
  const appearance = await hostEval(
    host,
    page,
    `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return [
        'Dimensions: ' + Math.round(rect.width) + 'x' + Math.round(rect.height),
        'Computed styles:',
        '  display: ' + style.display,
        '  font-size: ' + style.fontSize,
        '  color: ' + style.color,
        '  background: ' + style.backgroundColor
      ].join('\\n');
    })()`
  )
  const [dimensions, ...styles] = appearance.split('\n')
  return { dimensions, styles: styles.join('\n') }
}

test('picks and annotates real elements on a headless host from the paired desktop', async ({
  testRepoPath
}, testInfo) => {
  test.setTimeout(180_000)
  const fixture = await startRemoteGrabFixture()
  let host: HeadlessPairedRuntimeHost | undefined
  let client: PairedElectronClient | undefined
  try {
    host = await launchHeadlessPairedRuntimeHost()
    await host.client.call('repo.add', { path: testRepoPath, kind: 'git' })
    client = await launchPairedElectronClient(host.offer, testInfo, 'Remote element picker host')
    // Substitute only the clipboard IPC; never touch the user's system clipboard.
    await client.app.evaluate(({ ipcMain }) => {
      delete process.env.ORCA_E2E_COPIED_TEXT
      ipcMain.removeHandler('clipboard:writeText')
      ipcMain.handle('clipboard:writeText', (_event, text: string) => {
        process.env.ORCA_E2E_COPIED_TEXT = text
      })
    })
    const takeCopiedText = (): Promise<string | null> =>
      client!.app.evaluate(() => {
        const text = process.env.ORCA_E2E_COPIED_TEXT ?? null
        delete process.env.ORCA_E2E_COPIED_TEXT
        return text
      })
    const { page } = client
    await page.evaluate(async () => {
      const state = window.__store?.getState()
      if (!state) {
        throw new Error('Paired client store unavailable')
      }
      await state.updateSettings({ uiLanguage: 'en' })
      window.localStorage.setItem('orca.browser.markup-draw-hint-seen', 'true')
    })
    const worktreeId = await findPairedWorktreeId(page, testRepoPath)
    const created = await host.client.call<{ browserPageId: string }>('browser.tabCreate', {
      worktree: `id:${worktreeId}`,
      url: fixture.url,
      activate: false,
      placement: { kind: 'server' }
    })
    const remotePage = created.result.browserPageId
    await focusMaterializedRemoteBrowserPane(page, {
      environmentId: client.environmentId,
      remotePageId: remotePage,
      worktreeId
    })
    const pane = page
      .getByTestId('remote-browser-pane')
      .filter({ has: page.getByTestId('remote-browser-frame') })
    const frame = pane.getByTestId('remote-browser-frame')
    const grab = pane.getByRole('button', { name: 'Grab page element', exact: true })
    const annotate = pane.getByRole('button', { name: 'Annotate page element', exact: true })
    const overlay = pane.getByTestId('remote-browser-grab-overlay')
    const clickCount = () =>
      hostEval(host!, remotePage, 'document.querySelector("#remote-grab-button").textContent')
    await expect(frame).toBeVisible({ timeout: 60_000 })
    await expect(grab).toBeEnabled()
    await expectRemoteBrowserFrameFreshness({
      page,
      frame,
      evaluate: (expression) => hostEval(host!, remotePage, expression),
      reload: () => pane.getByRole('button', { name: 'Reload', exact: true }).click()
    })

    // Copy: the click selects at its own coordinates and never reaches the page.
    const button = await elementPoint(host, remotePage, '#remote-grab-button', frame)
    const buttonAppearance = await elementAppearance(host, remotePage, '#remote-grab-button')
    const buttonText = [
      `Attached browser context from ${new URL(fixture.url).href}`,
      '',
      'Selected element:',
      'button',
      'Accessible name: "Action count: 0"',
      'Role: button',
      'Selector: button#remote-grab-button',
      'React: <RemoteGrabApp> <RemoteGrabButton>',
      buttonAppearance.dimensions,
      '',
      'Text content:',
      'Action count: 0',
      '',
      'Nearby context:',
      '- This React app runs on the headless host.',
      '- Remote headless element remote-grab',
      '',
      buttonAppearance.styles,
      '',
      'HTML:',
      '<button id="remote-grab-button">Action count: 0</button>',
      '',
      'Ancestor path: main > div > body',
      'Full DOM path: body > div#root > main > button#remote-grab-button'
    ].join('\n')
    await grab.click()
    await expect(overlay).toContainText('Click an element')
    await page.mouse.move(button.x, button.y)
    await expect(pane.getByTestId('remote-browser-grab-outline')).toBeVisible()
    await page.mouse.click(button.x, button.y)
    await expect.poll(takeCopiedText).toBe(buttonText)
    expect(await clickCount()).toBe('Action count: 0')
    await page.screenshot({ path: testInfo.outputPath('selected-remote-element.png') })

    // The confirmation toast rearms the picker on its own.
    await expect(overlay).toContainText('Click an element')
    const password = await elementPoint(host, remotePage, '#remote-grab-password', frame)
    const passwordAppearance = await elementAppearance(host, remotePage, '#remote-grab-password')
    const passwordText = [
      `Attached browser context from ${new URL(fixture.url).href}`,
      '',
      'Selected element:',
      'input',
      'Role: input',
      'Selector: input',
      'React: <RemoteGrabApp>',
      passwordAppearance.dimensions,
      '',
      'Nearby context:',
      '- Action count: 0',
      '- This React app runs on the headless host.',
      '- Remote headless element remote-grab',
      '',
      passwordAppearance.styles,
      '',
      'HTML:',
      '<input id="[redacted]" type="[redacted]">',
      '',
      'Ancestor path: main > div > body',
      'Full DOM path: body > div#root > main > input'
    ].join('\n')
    await page.mouse.click(password.x, password.y)
    await expect.poll(takeCopiedText).toBe(passwordText)

    // Stateless queries: nothing was ever installed in the host page.
    expect(
      await hostEval(
        host,
        remotePage,
        'Boolean(document.getElementById("__orca-grab-host") || window.__orcaGrab)'
      )
    ).toBe('false')

    await page.keyboard.press('Escape')
    await expect(overlay).toHaveCount(0)
    await page.mouse.click(button.x, button.y)
    await expect.poll(clickCount).toBe('Action count: 1')

    // Annotate: the existing comment card and tray take the remote selection.
    await annotate.click()
    await expect(overlay).toContainText('Click an element')
    await page.mouse.click(button.x, button.y)
    const comment = page.getByPlaceholder('Describe what the agent should change here...')
    await comment.fill('Make this button primary')
    await page
      .getByRole('dialog', { name: 'Add browser annotation', exact: true })
      .getByRole('button', { name: /^Add\b/ })
      .click()
    await expect(pane.getByText('1 annotation', { exact: true })).toBeVisible()
    expect(await clickCount()).toBe('Action count: 1')
    await page.screenshot({ path: testInfo.outputPath('remote-annotation.png') })

    // Navigation and disconnect retire the picker without leaving the pane wedged.
    await page.keyboard.press('Escape')
    await expect(overlay).toHaveCount(0)
    await grab.click()
    await expect(overlay).toContainText('Click an element')
    await pane.getByRole('button', { name: 'Reload', exact: true }).click()
    await expect(overlay).toHaveCount(0)
    await expect(grab).toBeEnabled()
    await grab.click()
    await expect(overlay).toContainText('Click an element')
    await page.evaluate(
      async (id) => window.api.runtimeEnvironments.disconnect({ selector: id }),
      client.environmentId
    )
    await expect(overlay).toHaveCount(0)

    for (const app of [host.app, client.app]) {
      expect(
        await app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().every((window) => !window.isVisible())
        )
      ).toBe(true)
    }
  } finally {
    try {
      await client?.dispose()
    } finally {
      try {
        await host?.dispose()
      } finally {
        await fixture.close()
      }
    }
  }
})
