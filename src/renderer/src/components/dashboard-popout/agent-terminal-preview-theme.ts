import type { ITheme } from '@xterm/xterm'
import { composeActiveTerminalTheme } from '../../../../shared/compose-active-terminal-theme'
import { isTuiAgent } from '../../../../shared/tui-agent-config'
import type { GlobalSettings } from '../../../../shared/global-settings-types'
import type { TuiAgent } from '../../../../shared/tui-agent'
import { getBuiltinTheme, resolveEffectiveTerminalAppearance } from '@/lib/terminal-theme'

export function resolvePreviewAgent(agentType?: string | null): TuiAgent | null {
  return isTuiAgent(agentType) ? agentType : null
}

export function resolveAgentPreviewTheme(
  settings: GlobalSettings | null | undefined,
  systemPrefersDark: boolean,
  agent?: TuiAgent | null
): { terminalTheme: ITheme | null; terminalMode: 'dark' | 'light' } {
  if (!settings) {
    return { terminalTheme: null, terminalMode: 'dark' }
  }
  const appearance = resolveEffectiveTerminalAppearance(settings, systemPrefersDark, agent)
  return {
    terminalTheme: composeActiveTerminalTheme(
      appearance.theme ?? getBuiltinTheme(appearance.themeName),
      settings
    ),
    terminalMode: appearance.mode
  }
}
