import type { AppState } from './types'

type TerminalFullscreenChromeState = Pick<
  AppState,
  'sidebarOpen' | 'rightSidebarOpen' | 'statusBarVisible' | 'terminalFullscreen'
>

// Each surface shows when its saved setting says so and no terminal is fullscreen.

export function selectLeftSidebarShown(state: TerminalFullscreenChromeState): boolean {
  return state.sidebarOpen && !state.terminalFullscreen
}

export function selectRightSidebarShown(state: TerminalFullscreenChromeState): boolean {
  return state.rightSidebarOpen && !state.terminalFullscreen
}

export function selectStatusBarShown(state: TerminalFullscreenChromeState): boolean {
  return state.statusBarVisible && !state.terminalFullscreen
}
