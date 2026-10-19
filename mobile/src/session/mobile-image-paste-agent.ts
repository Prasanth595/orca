import { resolveMobileTerminalTabAgentId } from './mobile-terminal-tab-agent'
import type { MobileSessionTab } from './mobile-session-route-types'

/**
 * Which agent an attached image is formatted for. A terminal tab uses the same identity as its tab
 * icon (hook status, then the agent Orca launched, then the title), so a Codex tab whose hook
 * status has not arrived yet — or reported `unknown` — still gets the raw-path paste Codex turns
 * into an image attachment instead of an `@path` mention it leaves as text.
 */
export function resolveMobileImageAttachmentAgent(
  tab: MobileSessionTab | null | undefined,
  nativeChatAgent: string | null
): string | null {
  if (tab?.type === 'terminal') {
    return resolveMobileTerminalTabAgentId(tab) ?? nativeChatAgent
  }
  return nativeChatAgent
}
