import {
  terminalOscColorQueryReplies,
  type TerminalOscColorQueryReplyColors
} from './terminal-osc-color-reply'
import { isTuiAgent } from './tui-agent-config'
import type { TuiAgent } from './tui-agent'

export type PtyStartupIngressIntent = {
  colors: TerminalOscColorQueryReplyColors
  /** Agent the pane launched with; selects that agent's host colours for OSC 10/11. */
  launchAgent?: TuiAgent
  kittyKeyboardProtocol?: boolean
  deadlineMs: number
}

export const PTY_STARTUP_INGRESS_VERSION = 2

export function parsePtyStartupIngressIntent(value: unknown): PtyStartupIngressIntent | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const kittyKeyboardProtocol =
    'kittyKeyboardProtocol' in value && value.kittyKeyboardProtocol === true
  const colors = 'colors' in value ? value.colors : undefined
  const normalizedColors = {
    ...(colors &&
    typeof colors === 'object' &&
    'foreground' in colors &&
    typeof colors.foreground === 'string'
      ? { foreground: colors.foreground }
      : {}),
    ...(colors &&
    typeof colors === 'object' &&
    'background' in colors &&
    typeof colors.background === 'string'
      ? { background: colors.background }
      : {})
  }
  const launchAgent = 'launchAgent' in value ? value.launchAgent : undefined
  const deadlineMs = 'deadlineMs' in value ? value.deadlineMs : undefined
  if (
    (!kittyKeyboardProtocol && !terminalOscColorQueryReplies(normalizedColors, [10, 11])) ||
    typeof deadlineMs !== 'number' ||
    !Number.isFinite(deadlineMs) ||
    deadlineMs < 0 ||
    deadlineMs > 30_000
  ) {
    return undefined
  }
  return {
    colors: normalizedColors,
    ...(isTuiAgent(launchAgent) ? { launchAgent } : {}),
    ...(kittyKeyboardProtocol ? { kittyKeyboardProtocol: true } : {}),
    deadlineMs
  }
}
