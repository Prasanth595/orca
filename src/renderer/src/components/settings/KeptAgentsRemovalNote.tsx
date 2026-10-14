import { translate } from '@/i18n/i18n'
import { useAppStore } from '../../store'
import type { AgentRunAccountProvider } from '../../../../shared/agent-run-account'
import { countTerminalAgentsByAccount } from '../status-bar/count-terminal-agents-by-account'

const EMPTY_ROWS = {}
const EMPTY_TABS = {}

/** Says what removal does to agents kept on the account: they follow the selection again. */
export function KeptAgentsRemovalNote({
  provider,
  accountId,
  enabled
}: {
  provider: AgentRunAccountProvider
  accountId: string
  /** Off for another runtime's or a WSL account, whose agents this host does not see. */
  enabled: boolean
}): React.JSX.Element | null {
  const count = useAppStore((state) =>
    enabled
      ? countTerminalAgentsByAccount({
          rows: state.agentStatusByPaneKey ?? EMPTY_ROWS,
          tabsByWorktree: state.tabsByWorktree ?? EMPTY_TABS,
          provider,
          accountId,
          keptOnly: true
        })
      : 0
  )
  if (count === 0) {
    return null
  }
  return (
    <p className="text-sm text-muted-foreground" data-kept-agents-removal-note>
      {count === 1
        ? translate(
            'components.settings.accountsPaneRemoval.keptAgentsOne',
            '1 terminal agent is kept on this account. After removal it follows the selected account from its next start.'
          )
        : translate(
            'components.settings.accountsPaneRemoval.keptAgentsOther',
            '{{value0}} terminal agents are kept on this account. After removal they follow the selected account from their next start.',
            { value0: count }
          )}
    </p>
  )
}
