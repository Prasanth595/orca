import { translate } from '@/i18n/i18n'
import { Label } from '../ui/label'
import { Switch } from '../ui/switch'
import { SearchableSetting } from './SearchableSetting'
import type { AccountsPaneSectionModel } from './accounts-pane-types'

export function renderClaudeSessionMoveSetting(
  model: Pick<
    AccountsPaneSectionModel,
    'claudeAccounts' | 'isRemoteAccountScope' | 'settings' | 'updateSettings'
  >
): React.JSX.Element | null {
  // Why this machine only: a move restarts panes running here, so it follows this machine's setting.
  if (model.isRemoteAccountScope || model.claudeAccounts.accounts.length === 0) {
    return null
  }
  const title = translate(
    'accounts.claude.moveIdleSessions',
    'Move idle sessions to the selected account'
  )
  const description = translate(
    'accounts.claude.moveIdleSessionsDescription',
    'After you switch accounts, a Claude session still on the old one reopens its conversation on the selected account once it has sat idle for a minute in a tab you are not looking at.'
  )
  return (
    <SearchableSetting
      title={title}
      description={description}
      keywords={['claude', 'account', 'move', 'session', 'resume', 'idle', 'switch']}
      className="flex items-center justify-between gap-4 py-2"
    >
      <div className="space-y-0.5">
        <Label>{title}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch
        aria-label={title}
        checked={model.settings.claudeMoveIdleSessions === true}
        onCheckedChange={(enabled) => model.updateSettings({ claudeMoveIdleSessions: enabled })}
      />
    </SearchableSetting>
  )
}
