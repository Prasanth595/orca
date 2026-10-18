import type { ReactNode } from 'react'
import { getAgentLabel } from '@/lib/agent-catalog'
import { basename } from '@/lib/path'
import { translate } from '@/i18n/i18n'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import type { TerminalAgent } from '../../../../shared/terminal-agent'
import { TabHoverCard } from './TabHoverCard'
import { TabAgentAccountLines } from './TabAgentAccountLines'
import { TerminalTabLeadingIcon } from './TerminalTabLeadingIcon'
import type { TerminalTabActivityStatus } from './terminal-tab-activity-status'

/** A terminal tab's hover card: what it runs, its live icon, and each agent pane's account. */
export function TerminalTabHoverCard({
  children,
  tabId,
  title,
  agent,
  shell,
  activityStatus
}: {
  children: ReactNode
  tabId: string
  title: string
  agent: TerminalAgent | null
  shell: TerminalTab['shellOverride']
  activityStatus: TerminalTabActivityStatus
}): React.JSX.Element {
  return (
    <TabHoverCard
      title={title}
      programName={
        agent
          ? getAgentLabel(agent)
          : shell
            ? basename(shell)
            : translate('tabHoverCard.terminal', 'Terminal')
      }
      details={<TabAgentAccountLines tabId={tabId} />}
      icon={
        <TerminalTabLeadingIcon
          agent={agent}
          activityStatus={activityStatus}
          shell={shell}
          showUnreadActivity={false}
          isActive
        />
      }
    >
      {children}
    </TabHoverCard>
  )
}
