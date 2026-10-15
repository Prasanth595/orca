import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RuntimeBrowserPageRegistry } from '../runtime-browser-page-registry'

const mocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
  getDefaultProfile: vi.fn(),
  getLocalProfile: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  wait: vi.fn()
}))
vi.mock('electron', () => ({
  ipcMain: { on: mocks.on, removeListener: mocks.removeListener }
}))
vi.mock('../../browser/browser-session-registry', () => ({
  browserSessionRegistry: {
    getProfile: mocks.getProfile,
    getDefaultProfile: mocks.getDefaultProfile
  }
}))
vi.mock('../../browser/browser-manager', () => ({
  browserManager: { getSessionProfileIdForTab: mocks.getLocalProfile }
}))
vi.mock('../../ipc/browser-tab-registration-wait', () => ({
  waitForTabRegistration: mocks.wait
}))
import { RuntimeBrowserProfiles } from './browser-profiles'

const profiles = [
  { id: 'default', label: 'Default', partition: 'persist:local-default' },
  { id: 'isolated', label: 'Isolated', partition: 'persist:local-isolated' }
]

function fixture(currentProfile = 'isolated') {
  const pages = new RuntimeBrowserPageRegistry()
  pages.publishClientPage({
    browserPageId: 'remote-page',
    workspaceId: 'workspace',
    browserProfileId: currentProfile,
    executionHostKey: 'remote-host',
    placement: {
      kind: 'client',
      browserHostClientId: 'desktop',
      browserHostGeneration: 1,
      pageHostGeneration: 1
    },
    url: 'https://example.com/authenticated',
    loading: false,
    active: true
  })
  const window = vi.fn(() => {
    throw new Error('must not access renderer')
  })
  const bridge = vi.fn(() => {
    throw new Error('must not require local bridge')
  })
  const runtime = new RuntimeBrowserProfiles(
    { getRuntimeBrowserPageRegistry: () => pages, getAuthoritativeWindow: window },
    {
      resolveBrowserCommandTarget: async (params) => ({
        browserPageId: params.page,
        worktreeId: params.worktree
      }),
      requireAgentBrowserBridge: bridge
    },
    { describeBrowserTab: vi.fn() }
  )
  return { pages, runtime, window, bridge }
}

describe('client placement profile switch safety', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getProfile.mockImplementation((id) => profiles.find((profile) => profile.id === id))
    mocks.getDefaultProfile.mockReturnValue(profiles[0])
    mocks.getLocalProfile.mockReturnValue('default')
  })

  it.each([
    ['isolated', 'default'],
    ['default', 'isolated']
  ])('rejects %s to %s without mutating the old guest or metadata', async (current, next) => {
    const { pages, runtime, window, bridge } = fixture(current)
    const before = pages.getPage('remote-page')
    await expect(
      runtime.browserTabSetProfile({ page: 'remote-page', profileId: next })
    ).rejects.toThrow('requires staged replacement support on both peers')
    expect(pages.getPage('remote-page')).toBe(before)
    expect(window).not.toHaveBeenCalled()
    expect(bridge).not.toHaveBeenCalled()
    expect(mocks.getLocalProfile).not.toHaveBeenCalled()
    expect(mocks.on).not.toHaveBeenCalled()
    expect(mocks.wait).not.toHaveBeenCalled()
  })

  it('uses authoritative profile identity for an actual no-op', async () => {
    const { runtime, window } = fixture()
    await expect(
      runtime.browserTabSetProfile({ page: 'remote-page', profileId: 'isolated' })
    ).resolves.toEqual({
      browserPageId: 'remote-page',
      profileId: 'isolated',
      profileLabel: 'Isolated'
    })
    expect(mocks.getLocalProfile).not.toHaveBeenCalled()
    expect(window).not.toHaveBeenCalled()
  })

  it('resolves the active client page without a server-local bridge', async () => {
    const { runtime, bridge } = fixture()
    await expect(
      runtime.browserTabSetProfile({ worktree: 'workspace', profileId: 'isolated' })
    ).resolves.toMatchObject({ browserPageId: 'remote-page', profileId: 'isolated' })
    expect(bridge).not.toHaveBeenCalled()
  })

  it('rejects an invalid profile without changing authoritative state', async () => {
    const { pages, runtime, window } = fixture()
    const before = pages.getPage('remote-page')
    await expect(
      runtime.browserTabSetProfile({ page: 'remote-page', profileId: 'missing' })
    ).rejects.toThrow('Browser profile missing was not found')
    expect(pages.getPage('remote-page')).toBe(before)
    expect(window).not.toHaveBeenCalled()
  })

  it('does not accept a page from a different explicit workspace', async () => {
    const { runtime } = fixture()
    await expect(
      runtime.browserTabSetProfile({
        page: 'remote-page',
        worktree: 'another-workspace',
        profileId: 'isolated'
      })
    ).rejects.toThrow('belongs to another workspace')
  })

  it('normalizes synthetic default before comparing the authoritative identity', async () => {
    const canonical = { id: 'canonical-default', label: 'Default', partition: 'persist:canonical' }
    mocks.getProfile.mockReturnValue(undefined)
    mocks.getDefaultProfile.mockReturnValue(canonical)
    const { runtime } = fixture('canonical-default')
    await expect(
      runtime.browserTabSetProfile({ page: 'remote-page', profileId: 'default' })
    ).resolves.toMatchObject({ profileId: 'canonical-default' })
  })
})
