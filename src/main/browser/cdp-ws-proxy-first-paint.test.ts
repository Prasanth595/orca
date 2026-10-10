import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type WebSocket from 'ws'
import { CdpWsProxy } from './cdp-ws-proxy'
import {
  connect,
  createMockWebContents,
  getSendCommandMethods,
  type MockWebContents
} from './cdp-ws-proxy-test-harness'

vi.mock('electron', () => ({
  webContents: { fromId: vi.fn() }
}))

function collectReplies(client: WebSocket): Map<number, Record<string, unknown>> {
  const replies = new Map<number, Record<string, unknown>>()
  client.on('message', (data) => {
    const reply = JSON.parse(data.toString())
    replies.set(reply.id, reply)
  })
  return replies
}

describe('CdpWsProxy input to a document that has never painted', () => {
  let mock: MockWebContents
  let proxy: CdpWsProxy
  let endpoint: string
  let painted: (value: boolean) => void
  const release = vi.fn()
  const holdPaint = vi.fn(() => release)

  beforeEach(async () => {
    release.mockReset()
    holdPaint.mockClear()
    mock = createMockWebContents()
    const firstPaint = new Promise<boolean>((resolve) => {
      painted = resolve
    })
    mock.webContents.debugger.sendCommand.mockImplementation(async (method, params) => {
      if (method !== 'Runtime.evaluate') {
        return {}
      }
      return params?.awaitPromise === true
        ? { result: { type: 'boolean', value: await firstPaint } }
        : { result: { type: 'object', value: [false, 7] } }
    })
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the mock implements every WebContents member the proxy calls.
    proxy = new CdpWsProxy(mock.webContents as never, holdPaint)
    endpoint = await proxy.start()
  })

  afterEach(async () => {
    await proxy.stop()
  })

  it('draws the page until it paints, then sends press and release in order', async () => {
    const client = await connect(endpoint)
    const replies = collectReplies(client)
    const press = { type: 'mousePressed', x: 5, y: 5, button: 'left', clickCount: 1 }
    client.send(JSON.stringify({ id: 1, method: 'Input.dispatchMouseEvent', params: press }))
    client.send(
      JSON.stringify({
        id: 2,
        method: 'Input.dispatchMouseEvent',
        params: { ...press, type: 'mouseReleased' }
      })
    )
    await vi.waitFor(() => expect(holdPaint).toHaveBeenCalledTimes(1))
    expect(getSendCommandMethods(mock)).not.toContain('Input.dispatchMouseEvent')

    painted(true)
    await vi.waitFor(() => expect(replies.size).toBe(2))
    const dispatched = mock.webContents.debugger.sendCommand.mock.calls
      .filter(([method]) => method === 'Input.dispatchMouseEvent')
      .map(([, params]) => params?.type)
    expect(dispatched).toEqual(['mousePressed', 'mouseReleased'])
    expect(release).toHaveBeenCalledTimes(1)
    client.close()
  })

  it('leaves key and text input alone', async () => {
    const client = await connect(endpoint)
    const replies = collectReplies(client)
    client.send(
      JSON.stringify({ id: 3, method: 'Input.dispatchKeyEvent', params: { type: 'keyDown' } })
    )
    client.send(JSON.stringify({ id: 4, method: 'Input.insertText', params: { text: 'a' } }))
    await vi.waitFor(() => expect(replies.size).toBe(2))
    expect(getSendCommandMethods(mock)).not.toContain('Runtime.evaluate')
    expect(holdPaint).not.toHaveBeenCalled()
    client.close()
  })
})
