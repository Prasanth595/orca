import { describe, expect, it, vi } from 'vitest'
import { closeRuntimeFileTabs } from './runtime-file-tab-close'
import type { WorkspaceSessionState } from '../../shared/workspace-session-state-types'
import { getDefaultWorkspaceSession } from '../../shared/constants'
import {
  buildHeadlessMobileSessionEditorTabs,
  retireHeadlessEditorTab
} from './mobile-session-editor-projection'
import type { RuntimeMobileSessionFileTab } from '../../shared/runtime-types'

const file = (id: string, relativePath: string, isDirty = false): RuntimeMobileSessionFileTab => ({
  type: 'file',
  id,
  relativePath,
  filePath: `/repo/${relativePath}`,
  title: relativePath,
  language: 'typescript',
  mode: 'edit',
  isDirty,
  isActive: false
})
function host(tabs = [file('a', 'a.ts'), file('b', 'b.ts')]) {
  return {
    listTabs: vi.fn(async () => ({ worktree: 'wt', tabs })),
    closeInRenderer: vi.fn(async () => {}),
    closeHeadless: vi.fn(async () => {})
  }
}

describe('runtime file close selection', () => {
  it('closes one path through the renderer batch', async () => {
    const runtime = host()
    expect(await closeRuntimeFileTabs(runtime, 'id:wt', { relativePath: 'a.ts' })).toEqual({
      worktree: 'wt',
      closed: ['a.ts']
    })
    expect(runtime.closeInRenderer).toHaveBeenCalledWith('wt', ['a'], false)
    expect(runtime.closeHeadless).not.toHaveBeenCalled()
  })
  it('closes every file in the selected workspace', async () => {
    const runtime = host()
    expect(await closeRuntimeFileTabs(runtime, 'id:wt', { all: true })).toEqual({
      worktree: 'wt',
      closed: ['a.ts', 'b.ts']
    })
    expect(runtime.closeInRenderer).toHaveBeenCalledWith('wt', ['a', 'b'], false)
  })
  it('refuses unknown paths', async () => {
    const runtime = host()
    await expect(
      closeRuntimeFileTabs(runtime, 'id:wt', { relativePath: 'missing.ts' })
    ).rejects.toThrow('File tab not found')
    expect(runtime.closeInRenderer).not.toHaveBeenCalled()
  })
  it('preflights all unsaved headless drafts', async () => {
    const runtime = {
      ...host([file('a', 'a.ts'), file('b', 'b.ts', true)]),
      closeInRenderer: undefined
    }
    await expect(closeRuntimeFileTabs(runtime, 'id:wt', { all: true })).rejects.toThrow(
      'Unsaved changes'
    )
    expect(runtime.closeHeadless).not.toHaveBeenCalled()
    await closeRuntimeFileTabs(runtime, 'id:wt', { all: true, force: true })
    expect(runtime.closeHeadless).toHaveBeenCalledTimes(2)
  })
  it('delegates live dirty state to the renderer guard', async () => {
    const runtime = host([file('a', 'a.ts', true)])
    runtime.closeInRenderer.mockRejectedValue(new Error('Unsaved changes: a.ts'))
    await expect(closeRuntimeFileTabs(runtime, 'id:wt', { all: true })).rejects.toThrow(
      'Unsaved changes'
    )
  })
  it('does not report success when the execution host is unreachable', async () => {
    const runtime = host()
    runtime.listTabs.mockRejectedValue(new Error('runtime_unavailable'))
    await expect(closeRuntimeFileTabs(runtime, 'id:wt', { all: true })).rejects.toThrow(
      'runtime_unavailable'
    )
    expect(runtime.closeInRenderer).not.toHaveBeenCalled()
  })
  it('accepts an empty --all without closing anything', async () => {
    const runtime = host([])
    expect(await closeRuntimeFileTabs(runtime, 'id:wt', { all: true })).toEqual({
      worktree: 'wt',
      closed: []
    })
    expect(runtime.closeInRenderer).not.toHaveBeenCalled()
  })
  it.each(['../a.ts', '/repo/a.ts', 'C:\\repo\\a.ts'])(
    'refuses paths outside the workspace: %s',
    async (relativePath) => {
      const runtime = host()
      await expect(closeRuntimeFileTabs(runtime, 'id:wt', { relativePath })).rejects.toThrow(
        'inside the selected worktree'
      )
      expect(runtime.listTabs).not.toHaveBeenCalled()
    }
  )

  it('matches Windows separators on the execution host, independent of client OS', async () => {
    const runtime = host([{ ...file('a', 'src/a.ts'), filePath: 'C:\\repo\\src\\a.ts' }])
    await closeRuntimeFileTabs(runtime, 'id:wt', { relativePath: 'src\\a.ts' })
    expect(runtime.closeInRenderer).toHaveBeenCalledWith('wt', ['a'], false)
  })

  it('preserves POSIX filenames containing a backslash', async () => {
    const runtime = host([file('a', 'a\\b.ts'), file('b', 'a/b.ts')])
    await closeRuntimeFileTabs(runtime, 'id:wt', { relativePath: 'a\\b.ts' })
    expect(runtime.closeInRenderer).toHaveBeenCalledWith('wt', ['a'], false)
  })

  it('retires persisted headless files and unified tabs without rebuilding them on hydration', async () => {
    let session: WorkspaceSessionState = {
      ...getDefaultWorkspaceSession(),
      openFilesByWorktree: {
        wt: [
          {
            filePath: '/repo/a.ts',
            relativePath: 'a.ts',
            language: 'typescript',
            worktreeId: 'wt'
          }
        ]
      }
    }
    const runtime = {
      listTabs: async () => ({
        worktree: 'wt',
        tabs: buildHeadlessMobileSessionEditorTabs('wt', session)
      }),
      closeHeadless: async (worktreeId: string, tabId: string, force: boolean) => {
        const tab = buildHeadlessMobileSessionEditorTabs(worktreeId, session).find(
          (tab) => tab.id === tabId
        )
        if (!tab) {
          throw new Error('Missing persisted file')
        }
        const next = retireHeadlessEditorTab(session, worktreeId, tab, force)
        if (!next) {
          throw new Error('Retirement refused')
        }
        session = next
      }
    }
    await closeRuntimeFileTabs(runtime, 'id:wt', { all: true })
    expect(session.openFilesByWorktree?.wt).toEqual([])
    expect(session.unifiedTabs?.wt ?? []).toEqual([])
    expect((await runtime.listTabs()).tabs).toEqual([])
  })
  it('closes one editor by path and leaves a separate diff to --all', async () => {
    const runtime = host([{ ...file('diff', 'a.ts'), mode: 'diff' }, file('edit', 'a.ts')])
    await closeRuntimeFileTabs(runtime, 'id:wt', { relativePath: 'a.ts' })
    expect(runtime.closeInRenderer).toHaveBeenCalledWith('wt', ['edit'], false)
  })
  it('retires a repeated headless file identity only once', async () => {
    const runtime = {
      ...host([file('a', 'a.ts'), { ...file('a', 'a.ts'), mode: 'diff' as const }]),
      closeInRenderer: undefined
    }
    await closeRuntimeFileTabs(runtime, 'id:wt', { all: true })
    expect(runtime.closeHeadless).toHaveBeenCalledTimes(1)
  })

  it('honors the host pinned-tab confirmation setting', async () => {
    const runtime = {
      ...host([{ ...file('a', 'a.ts'), isPinned: true }]),
      closeInRenderer: undefined,
      confirmClosePinnedTab: false
    }
    await closeRuntimeFileTabs(runtime, 'id:wt', { all: true })
    expect(runtime.closeHeadless).toHaveBeenCalledWith('wt', 'a', false)
  })
})
