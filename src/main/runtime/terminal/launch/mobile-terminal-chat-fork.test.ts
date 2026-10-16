import { describe, expect, it } from 'vitest'
import { buildMobileTerminalChatFork } from './mobile-terminal-chat-fork'

const cwd = process.platform === 'win32' ? 'C:\\repo' : '/tmp/repo'
const filePath = process.platform === 'win32' ? 'C:\\sessions\\chat.jsonl' : '/tmp/chat.jsonl'
const runtime = {
  platform: process.platform,
  pty: { shellOverride: undefined, terminalWindowsWslDistro: null }
}

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
