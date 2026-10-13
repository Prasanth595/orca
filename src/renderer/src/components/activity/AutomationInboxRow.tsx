import { Zap } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { parseHostStableKey } from '../../../../shared/automation-owner-key'
import type { AutomationInboxEntry } from '../../../../shared/automation-inbox'
import { EventTime } from './activity-thread-controls'
import {
  ActivityNotificationClearAction,
  ActivityNotificationReadAction
} from './activity-notification-actions'

export function AutomationInboxRow({
  entry,
  onOpen,
  onChange
}: {
  entry: AutomationInboxEntry
  onOpen: () => void
  onChange: (action: 'read' | 'unread' | 'dismiss') => void
}): React.JSX.Element {
  const catalog = parseHostStableKey(entry.catalogKey)
  const hostName = useAppStore((state) => {
    if (catalog?.authority.kind === 'runtime') {
      const environmentId = catalog.authority.environmentId
      return (
        state.runtimeEnvironments.find((environment) => environment.id === environmentId)?.name ??
        translate('auto.components.activity.automationInbox.remoteHost', 'Remote host')
      )
    }
    if (catalog?.selector.kind === 'ssh') {
      return (
        state.sshTargetLabels.get(catalog.selector.targetId) ??
        translate('auto.components.activity.automationInbox.remoteHost', 'Remote host')
      )
    }
    return translate('auto.components.activity.automationInbox.localHost', 'Local')
  })
  return (
    <div className="group border-b border-border py-1" data-automation-inbox-row="">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-auto w-full justify-start text-left"
        onClick={onOpen}
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1 py-2">
          <span className="flex min-w-0 items-center gap-2">
            <Zap className="size-3.5 shrink-0 text-muted-foreground" />
            <span className={cn('truncate text-xs', entry.read ? 'font-normal' : 'font-semibold')}>
              {entry.alert.title}
            </span>
          </span>
          <Badge
            className="self-start"
            variant={entry.alert.status === 'failed' ? 'destructive' : 'secondary'}
          >
            {entry.alert.status === 'failed'
              ? translate('auto.components.activity.automationInbox.failed', 'Failed')
              : translate(
                  'auto.components.activity.automationInbox.needsAttention',
                  'Needs attention'
                )}
          </Badge>
          <span className="line-clamp-2 whitespace-normal text-xs font-normal text-muted-foreground">
            {entry.alert.message}
          </span>
        </span>
      </Button>
      <div className="flex min-w-0 items-center gap-1.5 px-3 text-2xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">{hostName}</span>
        <ActivityNotificationClearAction onClear={() => onChange('dismiss')} />
        <ActivityNotificationReadAction
          unread={!entry.read}
          onMarkRead={() => onChange('read')}
          onMarkUnread={() => onChange('unread')}
          readLabel={translate(
            'auto.components.activity.automationInbox.markRead',
            'Mark automation alert read'
          )}
          unreadLabel={translate(
            'auto.components.activity.automationInbox.markUnread',
            'Mark automation alert unread'
          )}
        />
        <EventTime timestamp={entry.alert.createdAt} compact />
      </div>
    </div>
  )
}
