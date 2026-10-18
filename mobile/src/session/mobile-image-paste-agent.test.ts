import { describe, expect, it } from 'vitest'
import { resolveMobileImageAttachmentAgent } from './mobile-image-paste-agent'
import type { MobileSessionTab } from './mobile-session-route-types'

function terminalTab(overrides: Partial<Extract<MobileSessionTab, { type: 'terminal' }>> = {}) {
  return {
    type: 'terminal',
    id: 'tab-1',
    title: 'Terminal',
    terminal: 'term-1',
    isActive: true,
    ...overrides
  } satisfies MobileSessionTab
}

describe('resolveMobileImageAttachmentAgent', () => {
  it('prefers the hook-reported agent', () => {
    const tab = terminalTab({
      agentStatus: { agentType: 'codex' } as never,
      launchAgent: 'claude'
    })
    expect(resolveMobileImageAttachmentAgent(tab, null)).toBe('codex')
  })

  it('uses the launched agent before the first hook status arrives', () => {
    expect(resolveMobileImageAttachmentAgent(terminalTab({ launchAgent: 'codex' }), null)).toBe(
      'codex'
    )
  })

  it('skips an unknown hook agent and falls back to the launched agent', () => {
    const tab = terminalTab({
      agentStatus: { agentType: 'unknown' } as never,
      launchAgent: 'codex'
    })
    expect(resolveMobileImageAttachmentAgent(tab, null)).toBe('codex')
  })

  it('falls back to the native chat agent when the terminal names none', () => {
    expect(resolveMobileImageAttachmentAgent(terminalTab(), 'claude')).toBe('claude')
    expect(resolveMobileImageAttachmentAgent(terminalTab(), null)).toBeNull()
  })

  it('uses the native chat agent for non-terminal tabs', () => {
    expect(resolveMobileImageAttachmentAgent(null, 'codex')).toBe('codex')
  })
})
