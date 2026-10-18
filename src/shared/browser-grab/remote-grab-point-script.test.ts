import { runInNewContext } from 'node:vm'
import { Window } from 'happy-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clampGrabPayload } from './browser-grab-payload'
import {
  buildRemoteGrabPointScript,
  readRemoteGrabQueryResult,
  type RemoteGrabQuery,
  type RemoteGrabQueryResult
} from './remote-grab-point-script'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

function guest(html: string, url = 'http://localhost/fixture?token=hidden#fragment') {
  const window = new Window({ url, width: 800, height: 600 })
  cleanups.push(() => window.happyDOM.abort())
  window.document.body.innerHTML = html
  let target: ReturnType<typeof window.document.querySelector> =
    window.document.body.firstElementChild
  const hits: { x: number; y: number }[] = []
  window.document.elementFromPoint = (x: number, y: number) => {
    hits.push({ x, y })
    return target
  }
  const context = {
    window,
    document: window.document,
    Node: window.Node,
    NodeFilter: window.NodeFilter,
    URL,
    Date,
    Math,
    JSON,
    Object,
    Array,
    Set,
    String,
    Number
  }
  return {
    window,
    hits,
    pointAt: (selector: string | null) => {
      target = selector === null ? null : window.document.querySelector(selector)
    },
    run: (query: RemoteGrabQuery): RemoteGrabQueryResult =>
      // Mirrors the Electron host, which JSON-encodes object results of browser.eval.
      readRemoteGrabQueryResult({
        result: JSON.stringify(runInNewContext(buildRemoteGrabPointScript(query), context))
      })
  }
}

function armed(page: ReturnType<typeof guest>) {
  const probe = page.run({ kind: 'probe' })
  expect(probe.status).toBe('ready')
  return { document: probe.document, viewport: probe.viewport }
}

describe('remote element selection point script', () => {
  it('selects the element at the click coordinates without dispatching page input', () => {
    const page = guest('<button id="first">First</button><button id="second">Second</button>')
    const events = vi.fn()
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click', 'focusin', 'auxclick']) {
      page.window.document.addEventListener(type, events, true)
    }
    const fence = armed(page)
    page.pointAt('#second')
    const result = page.run({ kind: 'select', point: { x: 120, y: 40 }, ...fence })
    expect(page.hits.at(-1)).toEqual({ x: 120, y: 40 })
    expect(result.status).toBe('selected')
    const payload = result.status === 'selected' ? clampGrabPayload(result.payload) : null
    expect(payload?.target.selector).toBe('button#second')
    expect(payload?.target.textSnippet).toBe('Second')
    expect(payload?.page.sanitizedUrl).toBe('http://localhost/fixture')
    expect(events).not.toHaveBeenCalled()
    // Stateless: nothing is installed in the page between queries.
    expect(page.window.document.getElementById('__orca-grab-host')).toBeNull()
    expect('__orcaGrab' in page.window).toBe(false)
  })

  it('keeps one document identity per page and rejects a query armed on another', () => {
    const page = guest('<button>Pick</button>')
    const first = armed(page)
    expect(page.run({ kind: 'probe' }).document).toBe(first.document)
    const stale = page.run({
      kind: 'select',
      point: { x: 1, y: 1 },
      document: 'previous-document',
      viewport: first.viewport
    })
    expect(stale).toMatchObject({ status: 'stale', reason: 'document' })
    const reloaded = guest('<button>Pick</button>')
    expect(armed(reloaded).document).not.toBe(first.document)
  })

  it('rejects a click mapped through a different viewport or a frame from another scroll', () => {
    const page = guest('<button>Pick</button>')
    const fence = armed(page)
    expect(
      page.run({
        kind: 'select',
        point: { x: 1, y: 1 },
        document: fence.document,
        viewport: { width: fence.viewport.width + 40, height: fence.viewport.height }
      })
    ).toMatchObject({ status: 'stale', reason: 'viewport' })
    expect(
      page.run({ kind: 'select', point: { x: 1, y: 1 }, ...fence, scroll: { x: 0, y: 300 } })
    ).toMatchObject({ status: 'stale', reason: 'scroll' })
    expect(
      page.run({ kind: 'select', point: { x: 1, y: 1 }, ...fence, scroll: { x: 0, y: 1 } }).status
    ).toBe('selected')
  })

  it('answers hover with a bounded preview and no page content beyond a short label', () => {
    const page = guest(
      `<section role="region">${'word '.repeat(500)}<input value="secret"></section>`
    )
    const fence = armed(page)
    const result = page.run({ kind: 'preview', point: { x: 5, y: 5 }, ...fence })
    expect(result.status).toBe('preview')
    if (result.status !== 'preview') {
      return
    }
    expect(result.target.tagName).toBe('section')
    expect(result.target.role).toBe('region')
    expect(result.target.text.length).toBeLessThanOrEqual(40)
    expect(JSON.stringify(result)).not.toContain('secret')
    expect(
      buildRemoteGrabPointScript({ kind: 'preview', point: { x: 1, y: 1 }, ...fence }).length
    ).toBeLessThan(4096)
  })

  it('reports nothing selectable for the page root or a point outside the viewport', () => {
    const page = guest('<button>Pick</button>')
    const fence = armed(page)
    page.pointAt('body')
    expect(page.run({ kind: 'preview', point: { x: 5, y: 5 }, ...fence }).status).toBe('empty')
    page.pointAt('button')
    page.hits.length = 0
    expect(page.run({ kind: 'select', point: { x: 5000, y: 5 }, ...fence }).status).toBe('empty')
    expect(page.hits).toEqual([])
  })

  it.each([
    '<input type="password" value="private-value" data-token="private-value">',
    '<form><input value="private-value"><textarea>private-value</textarea><script>private-value</script><a href="/login?code=private-value">Sign in</a></form>'
  ])('omits form values and unsafe attributes from root and descendant HTML', (html) => {
    const page = guest(html)
    const fence = armed(page)
    const result = page.run({ kind: 'select', point: { x: 1, y: 1 }, ...fence })
    const payload = result.status === 'selected' ? clampGrabPayload(result.payload) : null
    expect(payload?.target.htmlSnippet).not.toContain('private-value')
    expect(payload?.target.htmlSnippet).not.toContain('data-token')
    expect(payload?.target.htmlSnippet).not.toContain('<script')
    expect(page.window.document.querySelector('input')?.getAttribute('value')).toBe('private-value')
  })

  it('refuses non-finite coordinates instead of interpolating them into the script', () => {
    expect(() =>
      buildRemoteGrabPointScript({
        kind: 'select',
        point: { x: Number.NaN, y: 1 },
        document: 'doc',
        viewport: { width: 1, height: 1 }
      })
    ).toThrow('Invalid element selection coordinates')
  })

  it('decodes object results from providers that do not JSON-encode, and rejects junk', () => {
    const context = { document: 'doc', viewport: { width: 10, height: 10 }, scroll: { x: 0, y: 0 } }
    expect(readRemoteGrabQueryResult({ result: { ...context, status: 'ready' } }).status).toBe(
      'ready'
    )
    expect(() => readRemoteGrabQueryResult({ result: 'armed' })).toThrow('invalid response')
    expect(() =>
      readRemoteGrabQueryResult({ result: JSON.stringify({ ...context, status: 'preview' }) })
    ).toThrow('invalid response')
    expect(() =>
      readRemoteGrabQueryResult({ result: JSON.stringify({ ...context, status: 'unknown' }) })
    ).toThrow('invalid response')
  })
})
