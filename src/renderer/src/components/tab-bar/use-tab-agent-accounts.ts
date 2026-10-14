import { useAppStore } from '../../store'
import { describeTabAgentAccounts, type TabAgentAccount } from './tab-agent-accounts'

/** Mounted only while a hover card or tab menu is open, so closed tabs pay nothing for it. */
export function useTabAgentAccounts(tabId: string): TabAgentAccount[] {
  const rows = useAppStore((state) => state.agentStatusByPaneKey)
  const layout = useAppStore((state) => state.terminalLayoutsByTabId?.[tabId])
  const settings = useAppStore((state) => state.settings)
  return describeTabAgentAccounts({ tabId, layout, rows: rows ?? {}, settings })
}
