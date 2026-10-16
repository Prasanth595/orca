import { describe, expect, it, vi } from 'vitest'
import { buildMobileTerminalChatFork } from './mobile-terminal-chat-fork'
import { prepareStructuredChatCliFork } from '../../../ai-vault/structured-chat-cli-fork'
vi.mock('../../../ai-vault/structured-chat-cli-fork', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../ai-vault/structured-chat-cli-fork')>(),
  prepareStructuredChatCliFork: vi.fn()
}))
const cwd = process.platform === 'win32' ? 'C:\\repo' : '/tmp/repo'
const filePath = process.platform === 'win32' ? 'C:\\sessions\\chat.jsonl' : '/tmp/chat.jsonl'
const runtime = { platform: process.platform, pty: { shellOverride: undefined, terminalWindowsWslDistro: null } }

describe('native chat fork launch recipe', () => {
  it('keeps Manual empty args, custom command and environment in an independent fork', () => {
    const startup = buildMobileTerminalChatFork({
      prepared: {
        useRealCodexHome: false,
        cliForkSource: {
          agent: 'claude', sourceAgent: 'claude', sessionId: 'original-chat',
          filePath, cwd, codexHome: null, executionHostPlatform: process.platform
        }
      },
      settings: {
        agentCmdOverrides: { claude: 'my-claude' },
        agentDefaultArgs: { claude: '' },
        agentDefaultEnv: { claude: { MY_SETTING: 'present' } }
      },
      runtime
    })
    expect(startup.command).toContain('my-claude')
    expect(startup.command).toContain('original-chat')
    expect(startup.command).toContain('fork-session')
    expect(startup.env).toMatchObject({ MY_SETTING: 'present' })
    expect(startup.cwd).toBe(cwd)
    expect(startup.launchRuntime).toBe(runtime)
    expect(startup).not.toHaveProperty('resumeProviderSession')
  })

  it('opens the host copy without reusing the chat identity', () => {
    const startup = buildMobileTerminalChatFork({
      prepared: {
        useRealCodexHome: false,
        forkedSession: { agent: 'opencode', sessionId: 'copy', filePath },
        cliForkSource: {
          agent: 'opencode', sourceAgent: 'opencode', sessionId: 'copy',
          filePath, cwd, codexHome: null, executionHostPlatform: process.platform
        }
      },
      settings: { agentDefaultArgs: { opencode: '' } },
      runtime
    })
    expect(startup.command).toContain('copy')
    expect(startup.command).not.toContain('original-chat')
    expect(startup.resumeProviderSession?.id).toBe('copy')
  })
})

it('places one owned PTY and refuses an unsaved chat before another spawn', async () => {
  const { OrcaRuntimeService } = await import('../../orca-runtime-test-mocks.spec')
  await import('../../orca-runtime-test-lifecycle.spec')
  const { store, TEST_WORKTREE_ID } = await import('../../orca-runtime-test-fixtures.spec')
  const { resolveMobileChatForkTargetGroup } = await import('./mobile-terminal-chat-fork-create')
  const spawn = vi.fn(async (_options: unknown) => ({ id: 'pty-fork' }))
  const admitTerminalPane = vi.fn(async () => 'admitted' as const)
  const runtime = new OrcaRuntimeService({ ...store, admitTerminalPane })
  runtime.setPtyController({ spawn, write: () => true, kill: () => true,
    getForegroundProcess: async () => null })
  const tabs = ['anchor', 'later', 'last', 'desktop-active'].map((id) => ({
    type: 'agent-session' as const, id, sessionId: id, agent: 'claude' as const,
    title: id, isActive: id === 'anchor' }))
  runtime.syncWindowGraph(0, { tabs: [], leaves: [], mobileSessionTabs: [{
    worktree: TEST_WORKTREE_ID, publicationEpoch: 'headless:fork-placement', snapshotVersion: 1,
    activeGroupId: 'desktop-group', activeTabId: 'anchor', activeTabType: 'agent-session', tabs,
    tabGroups: [
      { id: 'phone-group', activeTabId: 'anchor', tabOrder: ['anchor', 'later', 'last'] },
      { id: 'desktop-group', activeTabId: 'desktop-active', tabOrder: ['desktop-active'] }
    ]
  }] })
  const targetGroupId = resolveMobileChatForkTargetGroup({
    groups: [{ id: 'phone-group', tabOrder: ['anchor', 'later', 'last'] },
      { id: 'desktop-group', tabOrder: ['desktop-active'] }],
    afterDesktopTabId: 'anchor', activeGroupId: 'desktop-group'
  })
  expect(targetGroupId).toBe('phone-group')

  const created = await runtime['createRuntimeOwnedMobileSessionTerminal'](
    TEST_WORKTREE_ID, false, 'anchor', {
      afterDesktopTabId: 'anchor', targetGroupId, presentation: 'background',
      identity: { tabId: 'fork-tab', leafId: '11111111-1111-4111-8111-111111111111' }
    }
  )
  const listed = await runtime.listMobileSessionTabs(`id:${TEST_WORKTREE_ID}`)
  expect(admitTerminalPane).toHaveBeenCalledWith(expect.objectContaining({
    type: 'createTerminalTab', tabId: created.tab.parentTabId,
    groupId: 'phone-group', afterTabId: 'anchor'
  }), undefined)
  expect(spawn.mock.calls[0]?.[0]).not.toHaveProperty('afterTabId')
  expect(listed.tabs.map((tab) => tab.type === 'terminal' ? tab.parentTabId : tab.id)).toEqual([
    'anchor', created.tab.parentTabId, 'later', 'last', 'desktop-active' ])
  expect(listed.tabGroups?.map((group) => group.tabOrder)).toEqual([
    ['anchor', created.tab.parentTabId, 'later', 'last'], ['desktop-active'] ])
  vi.spyOn(runtime, 'ensureStructuredAgentSessionHost').mockResolvedValueOnce(undefined)
  vi.mocked(prepareStructuredChatCliFork).mockRejectedValueOnce(new Error('This chat has no saved conversation to copy.'))
  await expect(runtime['createMobileChatForkTerminal']({
    workspace: { id: TEST_WORKTREE_ID, path: cwd, connectionId: null, repo: null, folderWorkspace: null },
    worktreeId: TEST_WORKTREE_ID,
    opts: { sourceChatFork: { sessionId: 'unsaved-chat' }, clientMutationId: 'next-create' },
    graphEpoch: 0
  })).rejects.toThrow('chat_fork_source_unavailable')
  expect(spawn).toHaveBeenCalledOnce()
})
