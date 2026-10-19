import { describe, expect, it } from 'vitest'
import type { TuiAgent } from '../../../src/shared/tui-agent'
import type { MobileSessionTab } from './mobile-session-route-types'
import { terminalSgrMousePrograms } from './terminal-sgr-mouse-programs'

function terminalTab(terminal: string | null, launchAgent?: TuiAgent): MobileSessionTab {
  return {
    type: 'terminal',
    id: `tab-${terminal}`,
    title: 'Terminal',
    terminal,
    isActive: false,
    ...(launchAgent ? { launchAgent } : {})
  }
}

describe('terminalSgrMousePrograms', () => {
  it('names the terminals running Claude Code or Codex', () => {
    const programs = terminalSgrMousePrograms([
      terminalTab('pty-claude', 'claude'),
      terminalTab('pty-codex', 'codex'),
      terminalTab('pty-gemini', 'gemini'),
      terminalTab('pty-shell'),
      terminalTab(null, 'claude')
    ])

    expect([...programs]).toEqual(['pty-claude', 'pty-codex'])
  })
})
