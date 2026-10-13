import { describe, expect, it, vi } from 'vitest'
import { getDefaultWorkspaceSession } from '../../shared/constants'
import type { WorkspaceSessionState } from '../../shared/workspace-session-state-types'
import { OrcaRuntimeService } from './orca-runtime'

const WT = 'repo::/worktree'
function fixture(dirty = false) {
  let session: WorkspaceSessionState = {
    ...getDefaultWorkspaceSession(),
    openFilesByWorktree: {
      [WT]: [
        {
          filePath: '/worktree/a.ts',
          relativePath: 'a.ts',
          language: 'typescript',
          worktreeId: WT,
          ...(dirty ? { dirtyDraftContent: 'draft' } : {})
        }
      ]
    }
  }
  const store = {
    getSettings: () => ({ confirmClosePinnedTab: true }),
    getWorkspaceSession: () => session,
    setWorkspaceSession: (next: WorkspaceSessionState) => {
      session = next
    }
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: This isolated store provides every settings and session member used by file close and hydration.
  const runtime = new OrcaRuntimeService(store as never)
  return { runtime, getSession: () => session }
}

describe('runtime service file close', () => {
  it('retires a headless editor durably through the actual runtime entry point', async () => {
    const { runtime, getSession } = fixture()
    expect(await runtime.closeFileTabs(`id:${WT}`, { all: true })).toEqual({
      worktree: WT,
      closed: ['a.ts']
    })
    expect(getSession().openFilesByWorktree?.[WT]).toEqual([])
    expect((await runtime.listMobileSessionTabs(`id:${WT}`)).tabs).toEqual([])
  })
  it('refuses an unsaved headless draft until force is explicit', async () => {
    const { runtime, getSession } = fixture(true)
    await expect(runtime.closeFileTabs(`id:${WT}`, { all: true })).rejects.toThrow(
      'Unsaved changes'
    )
    expect(getSession().openFilesByWorktree?.[WT]?.[0]?.dirtyDraftContent).toBe('draft')
    await runtime.closeFileTabs(`id:${WT}`, { all: true, force: true })
    expect(getSession().openFilesByWorktree?.[WT]).toEqual([])
  })
  it('awaits the renderer refusal instead of reporting success or falling back to headless', async () => {
    const { runtime, getSession } = fixture()
    const closeSessionTab = vi.fn(async () => {
      throw new Error('Unsaved changes: a.ts')
    })
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: File close uses only this notifier member; no other runtime operation runs in this fixture.
    runtime.setNotifier({ closeSessionTab } as never)
    await expect(runtime.closeFileTabs(`id:${WT}`, { relativePath: 'a.ts' })).rejects.toThrow(
      'Unsaved changes: a.ts'
    )
    expect(closeSessionTab).toHaveBeenCalledWith('/worktree/a.ts', WT, {
      tabIds: ['/worktree/a.ts'],
      force: false
    })
    expect(getSession().openFilesByWorktree?.[WT]).toHaveLength(1)
  })
})
