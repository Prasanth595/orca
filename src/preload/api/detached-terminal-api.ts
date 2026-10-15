export type DetachedTerminalOpenArgs = {
  tabId: string
  ptyId: string
  title: string
}

export type DetachedTerminalApi = {
  open: (args: DetachedTerminalOpenArgs) => Promise<void>
  close: (tabId: string) => Promise<void>
  returnToMain: (tabId: string) => Promise<void>
  onClosed: (callback: (tabId: string) => void) => () => void
}
