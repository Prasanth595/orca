import { describe, expect, it, vi } from 'vitest'
import { AI_VAULT_CHAT_FORK_SOURCE_CAPABILITY } from '../../../src/shared/ai-vault-resume-preparation'
import type { MobileTerminalResumeLaunch } from './mobile-native-chat-cli-fork'

vi.mock('lucide-react-native', () => ({ SquareTerminal: 'Icon' }))
vi.mock('../platform/haptics', () => ({ triggerError: vi.fn() }))

const { canOfferMobileNativeChatCliFork, runMobileNativeChatCliFork } =
  await import('./mobile-native-chat-cli-fork')

type CreatedTerminal = {
  startupCommand: string
  resumeLaunch: MobileTerminalResumeLaunch
  errorToast: string
}

function hostReplying(prepare: unknown) {
  // Untyped like the other fake clients here: replies are raw wire envelopes.
  return vi.fn().mockImplementation(async (method: string) => {
    if (method === 'aiVault.prepareSessionResume') {
      return prepare
    }
    if (method === 'settings.get') {
      return { ok: true, result: { settings: { agentDefaultArgs: { claude: '--model opus' } } } }
    }
    return { ok: true, result: { capabilities: [AI_VAULT_CHAT_FORK_SOURCE_CAPABILITY] } }
  })
}

function source(overrides: Record<string, unknown> = {}) {
  return {
    agent: 'claude',
    sourceAgent: 'claude',
    sessionId: 'claude-conversation',
    filePath: '/Users/ada/.claude/projects/repo/claude-conversation.jsonl',
    cwd: '/Users/ada/repo',
    codexHome: null,
    executionHostPlatform: 'darwin',
    ...overrides
  }
}

async function run(sendRequest: ReturnType<typeof hostReplying>, agent = 'claude') {
  const createTerminal = vi.fn(async (_options: CreatedTerminal) => {})
  const showToast = vi.fn()
  await runMobileNativeChatCliFork({
    client: { sendRequest },
    worktreeId: 'repo::/Users/ada/repo',
    tab: { sessionId: 'chat-1', agent },
    createTerminal,
    showToast
  })
  return { createTerminal, showToast }
}

describe('runMobileNativeChatCliFork', () => {
  it('asks the chat host for its conversation and opens its fork in a new terminal', async () => {
    const sendRequest = hostReplying({ ok: true, result: { cliForkSource: source() } })
    const { createTerminal, showToast } = await run(sendRequest)

    expect(sendRequest).toHaveBeenCalledWith(
      'aiVault.prepareSessionResume',
      { sourceChat: { sessionId: 'chat-1', workspaceId: 'repo::/Users/ada/repo' }, fork: true },
      { timeoutMs: 90_000 }
    )
    expect(showToast).not.toHaveBeenCalled()
    expect(createTerminal).toHaveBeenCalledTimes(1)
    const options = createTerminal.mock.calls[0]?.[0]
    expect(options?.startupCommand).toContain('claude-conversation')
    expect(options?.startupCommand).toContain('--fork-session')
    expect(options?.startupCommand).toMatch(/--model'? '?opus/)
    expect(options?.resumeLaunch).toMatchObject({ cwd: '/Users/ada/repo', launchAgent: 'claude' })
    expect(options?.resumeLaunch.launchConfig).toBeDefined()
  })

  it('opens the copy the host wrote with a plain resume, never a fork of the chat', async () => {
    const sendRequest = hostReplying({
      ok: true,
      result: {
        cliForkSource: source({
          agent: 'opencode',
          sourceAgent: 'opencode',
          sessionId: 'ses_copy',
          filePath: ''
        }),
        forkedSession: { agent: 'opencode', sessionId: 'ses_copy' }
      }
    })
    const { createTerminal } = await run(sendRequest, 'opencode')

    const options = createTerminal.mock.calls[0]?.[0]
    expect(options?.startupCommand).toContain('ses_copy')
    expect(options?.startupCommand).not.toContain('fork')
  })

  it('says why in one toast naming the agent when the host refuses, and opens nothing', async () => {
    const sendRequest = hostReplying({
      ok: false,
      error: { code: 'runtime_error', message: 'This chat has no saved conversation to copy.' }
    })
    const { createTerminal, showToast } = await run(sendRequest)

    expect(createTerminal).not.toHaveBeenCalled()
    expect(showToast).toHaveBeenCalledWith(
      'Could not open this Claude chat in a new CLI. This chat has no saved conversation to copy.',
      2400
    )
  })

  it('ignores a second tap while the first is still preparing', async () => {
    const sendRequest = hostReplying({ ok: true, result: { cliForkSource: source() } })
    await Promise.all([run(sendRequest), run(sendRequest)])

    expect(
      sendRequest.mock.calls.filter(([method]) => method === 'aiVault.prepareSessionResume')
    ).toHaveLength(1)
  })
})

describe('canOfferMobileNativeChatCliFork', () => {
  const capable = [AI_VAULT_CHAT_FORK_SOURCE_CAPABILITY]

  it.each([
    { agent: 'claude', hostCapabilities: capable, workspaceOnPairedHost: true, offered: true },
    { agent: 'opencode', hostCapabilities: capable, workspaceOnPairedHost: true, offered: true },
    // An older host has no chat-fork preparation.
    { agent: 'claude', hostCapabilities: [], workspaceOnPairedHost: true, offered: false },
    // A server workspace's chat is not the desktop's to prepare.
    { agent: 'claude', hostCapabilities: capable, workspaceOnPairedHost: false, offered: false },
    // A plain resume would make the terminal a second writer on the chat.
    { agent: 'cursor', hostCapabilities: capable, workspaceOnPairedHost: true, offered: false }
  ])('$agent on paired host $workspaceOnPairedHost → $offered', ({ offered, ...args }) => {
    expect(canOfferMobileNativeChatCliFork(args)).toBe(offered)
  })
})
