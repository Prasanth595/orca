// @vitest-environment happy-dom
//
// After a restart the host's status is not cached yet, so a restored preview of a page outside its
// workspace waits behind its loading state for the host's answer and renders by itself.
import { act } from 'react'
import type * as WebviewRegistryModule from '../host-guest/webview-registry'
import type * as DocPreviewGrantsModule from '@/lib/doc-preview-grants'
import type * as RuntimeRpcClientModule from '@/runtime/runtime-rpc-client'
import type * as WorktreeRuntimeOwnerModule from '@/lib/worktree-runtime-owner'
import type * as ConnectionOwnerResolutionModule from '@/lib/connection-owner-resolution'
import type { RuntimeStatus } from '../../../../../shared/runtime-types'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { FILES_HOST_PATH_RUNTIME_CAPABILITY } from '../../../../../shared/runtime-file-contracts'
import { clearRuntimeHostPathProbesForTests } from '@/runtime/runtime-file-address'

const PAGE = '/home/me/state/ab12/chart.html'

const host = vi.hoisted(() => {
  const state: {
    answer: ((capabilities: string[]) => void) | null
    fail: (() => void) | null
    minted: unknown[]
  } = { answer: null, fail: null, minted: [] }
  return state
})

vi.mock('@/runtime/runtime-rpc-client', async (importOriginal) => ({
  ...(await importOriginal<typeof RuntimeRpcClientModule>()),
  // Nothing is cached yet after a restart.
  peekRuntimeEnvironmentStatus: () => null,
  getRuntimeEnvironmentStatus: () =>
    new Promise<Pick<RuntimeStatus, 'capabilities'>>((resolve, reject) => {
      host.answer = (capabilities) => resolve({ capabilities })
      host.fail = () => reject(new Error('host unreachable'))
    })
}))

vi.mock('@/lib/doc-preview-grants', async (importOriginal) => ({
  ...(await importOriginal<typeof DocPreviewGrantsModule>()),
  ensureDocPreviewGrant: (_previewId: string, location: unknown) => {
    host.minted.push(location)
    const grantId = 'd'.repeat(32)
    return Promise.resolve({ grantId, url: `orca-preview://${grantId}/chart.html`, location })
  },
  releaseDocPreviewGrant: () => undefined
}))

vi.mock('@/lib/worktree-runtime-owner', async (importOriginal) => ({
  ...(await importOriginal<typeof WorktreeRuntimeOwnerModule>()),
  getRuntimeEnvironmentIdForWorktree: () => 'env-1'
}))
vi.mock('@/lib/connection-owner-resolution', async (importOriginal) => ({
  ...(await importOriginal<typeof ConnectionOwnerResolutionModule>()),
  getConnectionIdForFileFromState: () => null
}))

vi.mock('@/components/browser-pane/host-guest/webview-registry', async (importOriginal) => ({
  ...(await importOriginal<typeof WebviewRegistryModule>()),
  moveFocusToRendererBeforeWebviewDetach: () => undefined
}))

const browserAnnotationsByPageId: Record<string, unknown[]> = {}
const activeGroupIdByWorktree: Record<string, string> = {}
const storeState = {
  getKnownWorktreeById: () => ({ path: '/srv/repo' }),
  persistedUIReady: true,
  settings: {},
  keybindings: {},
  browserAnnotationsByPageId,
  activeGroupIdByWorktree,
  agentSendPopoverTargetMode: null,
  openAgentSendPopoverTargetMode: () => undefined,
  closeAgentSendPopoverTargetMode: () => undefined,
  addBrowserPageAnnotation: () => undefined,
  deleteBrowserPageAnnotation: () => undefined,
  clearBrowserPageAnnotations: () => undefined,
  recordFeatureInteraction: () => undefined,
  recordWorkspaceDocVisit: () => undefined,
  workspaceDocHistory: [],
  openFile: () => 'file-1'
}

vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (selector?: (state: typeof storeState) => unknown) =>
      selector ? selector(storeState) : storeState,
    { getState: () => storeState }
  )
}))

vi.mock('@/lib/execution-host-display-label', () => ({
  selectWorktreeHostDisplayLabel: () => 'Studio Mac mini'
}))

async function restorePreview(root: Root): Promise<void> {
  const { HtmlDocPreview } = await import('./HtmlDocPreview')
  await act(async () => {
    root.render(
      <TooltipProvider>
        <HtmlDocPreview
          previewId="preview-1"
          filePath={PAGE}
          relativePath={PAGE}
          worktreeId="wt-1"
          runtimeEnvironmentId="env-1"
        />
      </TooltipProvider>
    )
  })
}

describe('a restored preview of a page its host serves by path', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    clearRuntimeHostPathProbesForTests()
    host.answer = null
    host.fail = null
    host.minted = []
    Object.assign(window, {
      api: {
        docPreview: {
          authorizeDirectory: () => Promise.resolve(true),
          onLoadFailure: () => () => undefined
        },
        ui: { writeClipboardText: () => Promise.resolve() },
        browser: { setAnnotationViewportBridge: () => Promise.resolve(true) }
      }
    })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('waits quietly for the host, then renders without a reload', async () => {
    await restorePreview(root)

    // Still asking the host: the quiet loading state, never "unavailable".
    expect(host.minted).toEqual([])
    expect(container.querySelector('webview')).toBeNull()
    expect(container.textContent).not.toContain('Preview unavailable')

    await act(async () => {
      host.answer?.([FILES_HOST_PATH_RUNTIME_CAPABILITY])
    })

    expect(host.minted).toEqual([
      expect.objectContaining({
        owner: { kind: 'host-path', environmentId: 'env-1', worktreeSelector: 'id:wt-1' }
      })
    ])
    expect(container.querySelector('webview')).not.toBeNull()
    expect(container.textContent).not.toContain('Preview unavailable')
  })

  it('shows today’s unavailable page when the host cannot be reached', async () => {
    await restorePreview(root)

    await act(async () => {
      host.fail?.()
    })

    expect(host.minted).toEqual([])
    expect(container.textContent).toContain('Preview unavailable')
  })
})
