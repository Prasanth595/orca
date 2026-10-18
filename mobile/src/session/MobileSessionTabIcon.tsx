import { File, FileText, Globe } from 'lucide-react-native'
import { MobileAgentIcon } from '../components/MobileAgentIcon'
import { colors } from '../theme/mobile-theme'
import type { MobileSessionTab } from './mobile-session-route-types'
import { resolveMobileTerminalTabAgentId } from './mobile-terminal-tab-agent'

/** The type or agent mark a session tab carries, shared by the tab strip and the all-tabs list. */
export function MobileSessionTabIcon({ tab }: { tab: MobileSessionTab }) {
  switch (tab.type) {
    case 'browser':
      return <Globe size={13} color={colors.textSecondary} strokeWidth={2.1} />
    case 'markdown':
      return <FileText size={13} color={colors.textSecondary} strokeWidth={2.1} />
    case 'file':
      return <File size={13} color={colors.textSecondary} strokeWidth={2.1} />
    case 'agent-session':
      return <MobileAgentIcon agentId={tab.agent} size={13} />
    case 'terminal': {
      const agentId = resolveMobileTerminalTabAgentId(tab)
      return agentId ? <MobileAgentIcon agentId={agentId} size={13} /> : null
    }
  }
  return null
}
