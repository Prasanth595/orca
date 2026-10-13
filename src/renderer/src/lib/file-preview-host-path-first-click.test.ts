// After a restart no host status is cached yet. An explicit "Open Preview to the Side" on a page the
// host serves by path waits for the host's answer and opens the preview on the first click.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as RuntimeRpcClientModule from '@/runtime/runtime-rpc-client'
import type { RuntimeStatus } from '../../../shared/runtime-types'
import { FILES_HOST_PATH_RUNTIME_CAPABILITY } from '../../../shared/runtime-file-contracts'
import { clearRuntimeHostPathProbesForTests } from '@/runtime/runtime-file-address'

const PAGE = '/home/me/state/ab12/chart.html'

const mocks = vi.hoisted(() => ({
  toastError: vi.fn(),
  createBrowserTab: vi.fn(),
  createEmptySplitGroup: vi.fn(() => 'group-2'),
  getRuntimeEnvironmentStatus: vi.fn(),
  callRuntimeRpc: vi.fn()
}))

vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))
vi.mock('@/runtime/runtime-rpc-client', async (importOriginal) => ({
  ...(await importOriginal<typeof RuntimeRpcClientModule>()),
  peekRuntimeEnvironmentStatus: () => null,
  getRuntimeEnvironmentStatus: mocks.getRuntimeEnvironmentStatus,
  callRuntimeRpc: mocks.callRuntimeRpc
}))
vi.mock('@/lib/worktree-runtime-owner', () => ({
  getRuntimeEnvironmentIdForWorktree: () => 'env-1'
}))
vi.mock('@/lib/connection-owner-resolution', () => ({
  getConnectionIdForFileFromState: () => null
}))
vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({
      createBrowserTab: mocks.createBrowserTab,
      createEmptySplitGroup: mocks.createEmptySplitGroup,
      setActiveBrowserTab: vi.fn(),
      getKnownWorktreeById: () => ({ id: 'wt-1', path: '/srv/repo' }),
      browserTabsByWorktree: {},
      activeGroupIdByWorktree: {},
      groupsByWorktree: {},
      layoutByWorktree: {}
    })
  }
}))

import { openFilePreviewToSide } from './file-preview'

function capableStatus(): Pick<RuntimeStatus, 'capabilities'> {
  return { capabilities: [FILES_HOST_PATH_RUNTIME_CAPABILITY] }
}

beforeEach(() => {
  vi.clearAllMocks()
  clearRuntimeHostPathProbesForTests()
})

describe('the first Preview to the Side click with no cached host status', () => {
  it('waits for a capable host and opens the preview, with no refusal toast', async () => {
    mocks.getRuntimeEnvironmentStatus.mockResolvedValue(capableStatus())
    mocks.callRuntimeRpc.mockResolvedValue({ isDirectory: false })

    openFilePreviewToSide({
      language: 'html',
      filePath: PAGE,
      worktreeId: 'wt-1',
      sourceGroupId: 'group-1'
    })

    await vi.waitFor(() =>
      expect(mocks.createBrowserTab).toHaveBeenCalledWith(
        'wt-1',
        expect.any(String),
        expect.objectContaining({
          docLocation: { kind: 'workspace-doc', worktreeId: 'wt-1', filePath: PAGE },
          targetGroupId: 'group-2'
        })
      )
    )
    expect(mocks.callRuntimeRpc).toHaveBeenCalledWith(
      { kind: 'environment', environmentId: 'env-1' },
      'files.stat',
      { path: PAGE, access: { kind: 'user-file' } },
      { timeoutMs: 5_000 }
    )
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('keeps today’s refusal, without asking for the file, when the host cannot be reached', async () => {
    mocks.getRuntimeEnvironmentStatus.mockRejectedValue(new Error('host unreachable'))

    openFilePreviewToSide({
      language: 'html',
      filePath: PAGE,
      worktreeId: 'wt-1',
      sourceGroupId: 'group-1'
    })

    await vi.waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "Files outside the workspace can't be previewed on a paired server yet."
      )
    )
    expect(mocks.callRuntimeRpc).not.toHaveBeenCalled()
    expect(mocks.createBrowserTab).not.toHaveBeenCalled()
  })
})
