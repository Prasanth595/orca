import type { MobileSessionTab } from './mobile-session-route-types'
import { resolveMobileTerminalTabAgentId } from './mobile-terminal-tab-agent'

/**
 * Agents that enable SGR (1006) mouse reports in the same burst as mouse tracking, every time they
 * enable it: Claude Code sends `?1000h ?1002h ?1003h ?1006h` at start and again on every resize,
 * Codex sends the same four at start only. Claude Code ignores a click in the default encoding.
 */
const SGR_MOUSE_AGENTS: ReadonlySet<string> = new Set(['claude', 'codex'])

/**
 * The terminal handles whose program only ever reports the mouse with SGR, so a replay that lost
 * the encoding must not stop the phone's taps and wheels from reaching it.
 */
export function terminalSgrMousePrograms(tabs: readonly MobileSessionTab[]): ReadonlySet<string> {
  const handles = new Set<string>()
  for (const tab of tabs) {
    if (tab.type !== 'terminal' || !tab.terminal) {
      continue
    }
    const agent = resolveMobileTerminalTabAgentId(tab)
    if (agent && SGR_MOUSE_AGENTS.has(agent)) {
      handles.add(tab.terminal)
    }
  }
  return handles
}
