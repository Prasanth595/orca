import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as RuntimeFileAddressModule from '@/runtime/runtime-file-address'

const mocks = vi.hoisted(() => ({ servesFilesByPath: vi.fn() }))

vi.mock('@/runtime/runtime-file-address', async (importOriginal) => ({
  ...(await importOriginal<typeof RuntimeFileAddressModule>()),
  runtimeEnvironmentServesFilesByPath: mocks.servesFilesByPath
}))

import { useAppStore } from '@/store'
import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'
import { resolveDocPreviewGrantRequest } from '@/lib/doc-preview-grants'
import { makeRepo, makeWorktree } from '@/components/worktree-jump-palette-test-fixtures'
import { openNativeChatVisual } from './native-chat-visual-open'
import type { NativeChatVisualOwner } from './native-chat-visual-owner'

const WORKTREE_ID = 'repo-1::/srv/repo'
const LOCAL_PAGE = '/home/me/state/aaaa/usage.html'
const HOST_PAGE = '/home/me/state/bbbb/usage.html'

function seed(repo: Partial<Repo> = {}, worktree: Partial<Worktree> = {}): void {
  useAppStore.setState({
    repos: [{ ...makeRepo(), path: '/srv/repo', ...repo }],
    worktreesByRepo: {
      'repo-1': [makeWorktree(WORKTREE_ID, 'repo', { path: '/srv/repo', ...worktree })]
    },
    detectedWorktreesByRepo: {},
    openFiles: [],
    browserTabsByWorktree: {},
    browserPagesByWorkspace: {}
  })
}

function seedPaired(environmentId: string): void {
  seed({ executionHostId: `runtime:${environmentId}` }, { hostId: `runtime:${environmentId}` })
}

function chatOwner(target: NativeChatVisualOwner['target']): NativeChatVisualOwner {
  return { target, sessionId: 'session-alpha', worktreeId: WORKTREE_ID }
}

const hubA = chatOwner({ kind: 'environment', environmentId: 'hub-a' })

function browserPages(): { url: string; title: string; docLocation?: unknown }[] {
  return Object.values(useAppStore.getState().browserPagesByWorkspace).flat()
}

function visualTabs(): unknown[] {
  return useAppStore
    .getState()
    .openFiles.filter((file) => file.mode === 'chat-visual')
    .map((file) => file.chatVisual)
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.servesFilesByPath.mockResolvedValue(true)
  seed()
})

describe('opening a chat visual like any file', () => {
  it("opens a local chat's visual as a browser tab on its file URL", () => {
    openNativeChatVisual(chatOwner({ kind: 'local' }), {
      file: 'usage.html',
      title: 'Usage',
      path: LOCAL_PAGE
    })

    expect(browserPages()).toEqual([
      expect.objectContaining({ url: 'file:///home/me/state/aaaa/usage.html', title: 'Usage' })
    ])
    expect(visualTabs()).toEqual([])
  })

  it('spells a Windows scratch path as a drive file URL', () => {
    openNativeChatVisual(chatOwner({ kind: 'local' }), {
      file: 'usage.html',
      title: null,
      path: 'C:\\Users\\me\\state\\aaaa\\usage.html'
    })

    expect(browserPages()).toEqual([
      expect.objectContaining({
        url: 'file:///C:/Users/me/state/aaaa/usage.html',
        title: 'usage.html'
      })
    ])
  })

  it("opens a paired chat's visual in that host's document preview", async () => {
    seedPaired('hub-a')

    openNativeChatVisual(hubA, { file: 'usage.html', title: 'Usage', path: HOST_PAGE })

    expect(browserPages()).toEqual([
      expect.objectContaining({
        docLocation: { kind: 'workspace-doc', worktreeId: WORKTREE_ID, filePath: HOST_PAGE }
      })
    ])
    expect(visualTabs()).toEqual([])
    // The preview reads the file by path on the chat's own host.
    expect(
      await resolveDocPreviewGrantRequest(useAppStore.getState(), WORKTREE_ID, HOST_PAGE)
    ).toMatchObject({
      owner: { kind: 'host-path', environmentId: 'hub-a' },
      root: '/home/me/state/bbbb',
      entryRelativePath: 'usage.html'
    })
  })

  it('keeps the visual tab where the host has no path for it', () => {
    seedPaired('hub-a')

    openNativeChatVisual(hubA, { file: 'usage.html', title: 'Usage', path: null })

    expect(browserPages()).toEqual([])
    expect(visualTabs()).toEqual([
      {
        target: { kind: 'environment', environmentId: 'hub-a' },
        sessionId: 'session-alpha',
        file: 'usage.html',
        title: 'Usage'
      }
    ])
  })

  // Two hosts can share a workspace id; the workspace's preview would read the other host's disk.
  it("keeps the visual tab when the workspace's host is not the chat's", () => {
    seedPaired('hub-b')

    openNativeChatVisual(hubA, { file: 'usage.html', title: 'Usage', path: HOST_PAGE })

    expect(browserPages()).toEqual([])
    expect(visualTabs()).toHaveLength(1)
  })

  it('keeps the visual tab for a local chat in a paired workspace', () => {
    seedPaired('hub-a')

    openNativeChatVisual(chatOwner({ kind: 'local' }), {
      file: 'usage.html',
      title: 'Usage',
      path: LOCAL_PAGE
    })

    expect(browserPages()).toEqual([])
    expect(visualTabs()).toHaveLength(1)
  })

  it('keeps the visual tab for a local chat in an SSH workspace', () => {
    seed({ connectionId: 'ssh-1' }, { hostId: 'ssh:ssh-1' })

    openNativeChatVisual(chatOwner({ kind: 'local' }), {
      file: 'usage.html',
      title: 'Usage',
      path: LOCAL_PAGE
    })

    expect(browserPages()).toEqual([])
    expect(visualTabs()).toHaveLength(1)
  })

  // A paired host proxying an SSH workspace previews that workspace's machine, not its own disk.
  it('keeps the visual tab for an SSH workspace a paired host proxies', () => {
    seed(
      { connectionId: 'hub-target' },
      { hostId: 'ssh:hub-target', runtimeOwnerEnvironmentId: 'hub-a' }
    )

    openNativeChatVisual(hubA, { file: 'usage.html', title: 'Usage', path: HOST_PAGE })

    expect(browserPages()).toEqual([])
    expect(visualTabs()).toHaveLength(1)
  })
})
