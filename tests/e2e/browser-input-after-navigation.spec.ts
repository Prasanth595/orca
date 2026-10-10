/**
 * A click right after a navigation, on a page that is not being drawn.
 *
 * Agents open pages with `browser.tabCreate`, which shows nothing: the page is drawn only for the
 * 10 s bootstrap lease, then parked. A document that loads while parked never paints, and Chromium
 * holds a mouse move for a frame and drops a press that arrives before the first paint, so every
 * click after a `goto` took about 5 s and, depending on how the app was launched, did nothing.
 */

import { createServer, type Server } from 'node:http'
import type { Page } from '@stablyai/playwright-test'
import { test, expect } from './helpers/orca-app'
import { ensureTerminalVisible, getActiveWorktreeId, waitForActiveWorktree } from './helpers/store'

type RuntimeReply = { ok: boolean; result?: Record<string, unknown>; error?: unknown }

const CLICK_BUDGET_MS = 2_000

function page(name: string): string {
  return `<!doctype html><html><head><title>${name}</title></head><body>
    <button id="b" onclick="window.clicks = (window.clicks ?? 0) + 1">Press</button>
  </body></html>`
}

async function callRuntime(
  orcaPage: Page,
  method: string,
  params: Record<string, unknown>
): Promise<RuntimeReply> {
  const reply: unknown = await orcaPage.evaluate(
    ({ targetMethod, targetParams }) =>
      window.api.runtime.call({ method: targetMethod, params: targetParams }),
    { targetMethod: method, targetParams: params }
  )
  const value = reply !== null && typeof reply === 'object' ? reply : {}
  return {
    ok: Reflect.get(value, 'ok') === true,
    result: Reflect.get(value, 'result'),
    error: Reflect.get(value, 'error')
  }
}

async function evalInPage(orcaPage: Page, pageId: string, expression: string): Promise<unknown> {
  const reply = await callRuntime(orcaPage, 'browser.eval', { page: pageId, expression })
  return reply.result?.result
}

// Why checkVisibility: a parked pane hides the guest through a display: none ancestor.
async function isGuestParked(orcaPage: Page): Promise<boolean> {
  return orcaPage.evaluate(() => {
    const webviews = Array.from(document.querySelectorAll('webview'))
    return webviews.length > 0 && webviews.every((webview) => !webview.checkVisibility())
  })
}

test('a click right after goto lands promptly on a parked page', async ({ orcaPage }) => {
  test.setTimeout(120_000)
  const server: Server = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(page(request.url ?? '/'))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('page server has no port')
  }
  const origin = `http://127.0.0.1:${address.port}`
  try {
    await waitForActiveWorktree(orcaPage)
    await ensureTerminalVisible(orcaPage)
    const worktreeId = await getActiveWorktreeId(orcaPage)
    const created = await callRuntime(orcaPage, 'browser.tabCreate', {
      url: `${origin}/start`,
      worktree: `id:${worktreeId}`
    })
    expect(created.ok, JSON.stringify(created.error)).toBe(true)
    const pageId = String(created.result?.browserPageId)
    await expect
      .poll(() => evalInPage(orcaPage, pageId, 'document.readyState'), { timeout: 20_000 })
      .toBe('complete')

    for (let round = 0; round < 3; round += 1) {
      // The state agents end up in: the page parked (display: none), so nothing draws what goto loads.
      await expect
        .poll(() => isGuestParked(orcaPage), { timeout: 30_000, intervals: [250] })
        .toBe(true)
      const goto = await callRuntime(orcaPage, 'browser.goto', {
        page: pageId,
        url: `${origin}/page-${round}`
      })
      expect(goto.ok, JSON.stringify(goto.error)).toBe(true)
      const started = Date.now()
      const click = await callRuntime(orcaPage, 'browser.click', { page: pageId, element: '#b' })
      const elapsed = Date.now() - started
      expect(click.ok, JSON.stringify(click.error)).toBe(true)
      // Acted, on the new document: a click that reports ok must have been counted.
      expect(Number(await evalInPage(orcaPage, pageId, 'window.clicks ?? 0'))).toBe(1)
      expect(elapsed, `click ${round} took ${elapsed} ms`).toBeLessThan(CLICK_BUDGET_MS)
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
