import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useIpcEventsForCloseRouting,
  type SessionTabCloseRequestListener
} from './ipc-events-close-routing-test-harness'

describe('useIpcEvents session tab close requests', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('acknowledges a close after the store removes the tab', async () => {
    const listenerRef: { current: SessionTabCloseRequestListener | null } = { current: null }
    const closeUnifiedTab = vi.fn().mockReturnValue({ id: 'sim-tab-1' })
    const respondSessionTabClose = vi.fn()

    await useIpcEventsForCloseRouting({
      sessionTabCloseRequestListenerRef: listenerRef,
      respondSessionTabClose,
      getState: () => ({
        closeUnifiedTab,
        browserTabsByWorktree: {},
        openFiles: [],
        unifiedTabsByWorktree: {
          'wt-1': [
            { id: 'sim-tab-1', entityId: 'sim-1', contentType: 'simulator', isPinned: false }
          ]
        }
      })
    })

    listenerRef.current?.({
      requestId: 'close-session-tab',
      tabId: 'sim-tab-1',
      worktreeId: 'wt-1'
    })

    expect(closeUnifiedTab).toHaveBeenCalledWith('sim-tab-1')
    expect(respondSessionTabClose).toHaveBeenCalledWith({ requestId: 'close-session-tab' })
  })

  it('acknowledges an initiating command without re-prompting or removing its tab early', async () => {
    const listenerRef: { current: SessionTabCloseRequestListener | null } = { current: null }
    const closeUnifiedTab = vi.fn()
    const respondSessionTabClose = vi.fn()
    const requestPinnedTabCloseConfirm = vi.fn()
    await useIpcEventsForCloseRouting({
      sessionTabCloseRequestListenerRef: listenerRef,
      respondSessionTabClose,
      getState: () => ({
        closeUnifiedTab,
        requestPinnedTabCloseConfirm,
        browserTabsByWorktree: {},
        openFiles: [],
        unifiedTabsByWorktree: {
          'wt-1': [
            { id: 'chat-tab', entityId: 'session-1', contentType: 'agent-session', isPinned: true }
          ]
        }
      })
    })
    const { withLocalSessionTabCloseOwner } =
      await import('@/runtime/local-session-tab-close-owner')
    await withLocalSessionTabCloseOwner('wt-1', 'chat-tab', async () => {
      listenerRef.current?.({ requestId: 'owned-close', worktreeId: 'wt-1', tabId: 'chat-tab' })
      expect(respondSessionTabClose).toHaveBeenCalledWith({ requestId: 'owned-close' })
      expect(closeUnifiedTab).not.toHaveBeenCalled()
      expect(requestPinnedTabCloseConfirm).not.toHaveBeenCalled()
    })
    listenerRef.current?.({ requestId: 'independent-close', worktreeId: 'wt-1', tabId: 'chat-tab' })
    expect(requestPinnedTabCloseConfirm).toHaveBeenCalledOnce()
    expect(respondSessionTabClose).not.toHaveBeenCalledWith({ requestId: 'independent-close' })
  })

  it('rejects a pinned browser close when confirmation is canceled', async () => {
    const listenerRef: { current: SessionTabCloseRequestListener | null } = { current: null }
    const closeBrowserTab = vi.fn()
    const respondSessionTabClose = vi.fn()
    const requestPinnedTabCloseConfirm = vi.fn()

    await useIpcEventsForCloseRouting({
      sessionTabCloseRequestListenerRef: listenerRef,
      respondSessionTabClose,
      getState: () => ({
        closeBrowserTab,
        requestPinnedTabCloseConfirm,
        browserTabsByWorktree: { 'wt-1': [{ id: 'workspace-1' }] },
        unifiedTabsByWorktree: {
          'wt-1': [
            {
              id: 'browser-unified-1',
              entityId: 'workspace-1',
              contentType: 'browser',
              label: 'Docs',
              isPinned: true
            }
          ]
        }
      })
    })

    listenerRef.current?.({
      requestId: 'close-pinned-session-tab',
      tabId: 'workspace-1',
      worktreeId: 'wt-1'
    })
    const request = requestPinnedTabCloseConfirm.mock.calls[0][0] as { onCancel: () => void }
    request.onCancel()

    expect(closeBrowserTab).not.toHaveBeenCalled()
    expect(respondSessionTabClose).toHaveBeenCalledWith({
      requestId: 'close-pinned-session-tab',
      error: 'session_tab_close_canceled'
    })
  })

  it('expires a pending pinned close without allowing late confirmation', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    const listenerRef: { current: SessionTabCloseRequestListener | null } = { current: null }
    const closeBrowserTab = vi.fn()
    const respondSessionTabClose = vi.fn()
    const requestPinnedTabCloseConfirm = vi.fn()
    const cancelPinnedTabCloseRequest = vi.fn()

    await useIpcEventsForCloseRouting({
      sessionTabCloseRequestListenerRef: listenerRef,
      respondSessionTabClose,
      getState: () => ({
        closeBrowserTab,
        requestPinnedTabCloseConfirm,
        cancelPinnedTabCloseRequest,
        browserTabsByWorktree: { 'wt-1': [{ id: 'workspace-1' }] },
        unifiedTabsByWorktree: {
          'wt-1': [
            {
              id: 'browser-unified-1',
              entityId: 'workspace-1',
              contentType: 'browser',
              label: 'Docs',
              isPinned: true
            }
          ]
        }
      })
    })

    listenerRef.current?.({
      requestId: 'expiring-close',
      tabId: 'workspace-1',
      worktreeId: 'wt-1',
      expiresAt: 2_000
    })
    const request = requestPinnedTabCloseConfirm.mock.calls[0][0] as { onConfirm: () => void }
    vi.advanceTimersByTime(1_000)

    expect(cancelPinnedTabCloseRequest).toHaveBeenCalledWith(request)
    expect(respondSessionTabClose).toHaveBeenCalledWith({
      requestId: 'expiring-close',
      error: 'session_tab_close_timeout'
    })
    request.onConfirm()
    expect(closeBrowserTab).not.toHaveBeenCalled()
    expect(respondSessionTabClose).toHaveBeenCalledTimes(1)
  })
})

describe('file close IPC requests', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllGlobals()
  })

  it.each([false, true])('refuses a dirty draft unless force is explicit (%s)', async (force) => {
    const listenerRef: { current: SessionTabCloseRequestListener | null } = { current: null }
    const closeFile = vi.fn()
    const respondSessionTabClose = vi.fn()
    await useIpcEventsForCloseRouting({
      sessionTabCloseRequestListenerRef: listenerRef,
      respondSessionTabClose,
      getState: () => ({
        closeFile,
        editorDrafts: { 'file-1': 'unsaved' },
        openFiles: [{ id: 'file-1', worktreeId: 'wt-1', relativePath: 'a.ts', isDirty: false }],
        unifiedTabsByWorktree: {
          'wt-1': [{ id: 'tab-1', entityId: 'file-1', contentType: 'editor' }]
        }
      })
    })
    listenerRef.current?.({
      requestId: 'file-close',
      tabId: 'tab-1',
      worktreeId: 'wt-1',
      fileClose: { tabIds: ['tab-1'], force }
    })
    if (force) {
      expect(closeFile).toHaveBeenCalledWith('file-1')
      expect(respondSessionTabClose).toHaveBeenCalledWith({ requestId: 'file-close' })
    } else {
      expect(closeFile).not.toHaveBeenCalled()
      expect(respondSessionTabClose).toHaveBeenCalledWith({
        requestId: 'file-close',
        error: 'Unsaved changes: a.ts. Use --force to discard.'
      })
    }
  })

  it('does not apply an expired file close request', async () => {
    const listenerRef: { current: SessionTabCloseRequestListener | null } = { current: null }
    const closeFile = vi.fn()
    const respondSessionTabClose = vi.fn()
    await useIpcEventsForCloseRouting({
      sessionTabCloseRequestListenerRef: listenerRef,
      respondSessionTabClose,
      getState: () => ({ closeFile })
    })
    listenerRef.current?.({
      requestId: 'expired',
      tabId: 'tab-1',
      worktreeId: 'wt-1',
      expiresAt: Date.now() - 1,
      fileClose: { tabIds: ['tab-1'], force: true }
    })
    expect(closeFile).not.toHaveBeenCalled()
    expect(respondSessionTabClose).toHaveBeenCalledWith({
      requestId: 'expired',
      error: 'session_tab_close_timeout'
    })
  })
})
