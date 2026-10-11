import type { MobileTerminalTheme } from './terminal-webview-contract'
import { LIGHT_TERMINAL_THEME } from './terminal-webview-html/theme'

const LIGHT_TERMINAL_THEME_PAYLOAD: MobileTerminalTheme = {
  mode: 'light',
  theme: LIGHT_TERMINAL_THEME
}

// Why override the desktop's theme: the host publishes its own (usually dark) terminal theme,
// which would leave a black terminal inside an otherwise light app — unusable on e-ink.
export function selectTerminalTheme(
  isLight: boolean,
  hostTheme: MobileTerminalTheme | undefined
): MobileTerminalTheme | undefined {
  return isLight ? LIGHT_TERMINAL_THEME_PAYLOAD : hostTheme
}
