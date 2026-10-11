/**
 * Cold-start per-agent viewer colours from persisted GlobalSettings, for the PTY owner to answer
 * OSC 10/11 with before the first renderer snapshot lands. Same theme pipeline as the global seed
 * (`resolveConfiguredTerminalColors`), evaluated once per agent that has an override.
 */
import { normalizeAgentTerminalThemes } from '../../shared/agent-terminal-themes'
import type { GlobalSettings } from '../../shared/global-settings-types'
import type { TerminalOscColorQueryReplyColors } from '../../shared/terminal-osc-color-reply'
import { resolveConfiguredTerminalColors } from '../../shared/terminal-theme-selection'
import { isTuiAgent } from '../../shared/tui-agent-config'
import type { TuiAgent } from '../../shared/tui-agent'

type SeedSettings = Parameters<typeof resolveConfiguredTerminalColors>[0]

export function seedAgentViewerColors(
  settings: SeedSettings & Pick<GlobalSettings, 'agentTerminalThemes'>,
  systemPrefersDark: boolean
): Partial<Record<TuiAgent, TerminalOscColorQueryReplyColors>> {
  const byAgent: Partial<Record<TuiAgent, TerminalOscColorQueryReplyColors>> = {}
  for (const agent of Object.keys(normalizeAgentTerminalThemes(settings.agentTerminalThemes))) {
    if (isTuiAgent(agent)) {
      byAgent[agent] = resolveConfiguredTerminalColors(settings, systemPrefersDark, agent)
    }
  }
  return byAgent
}
