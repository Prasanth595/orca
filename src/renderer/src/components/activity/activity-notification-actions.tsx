import type { ReactNode } from 'react'
import { Bell, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { FilledBellIcon } from '../sidebar/WorktreeCardHelpers'

export function ActivityNotificationAction({
  label,
  onClick,
  keyboardReachable = false,
  children
}: {
  label: string
  onClick: () => void
  // Hover-only actions stay `invisible` so long lists don't gain a tab stop per row.
  keyboardReachable?: boolean
  children: ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className={cn(
            'size-4 p-0 text-muted-foreground transition-opacity hover:text-foreground can-hover:pointer-events-none can-hover:opacity-0 can-hover:group-hover:pointer-events-auto can-hover:group-hover:opacity-100 focus-visible:opacity-100',
            !keyboardReachable && 'can-hover:invisible can-hover:group-hover:visible'
          )}
          aria-label={label}
          onClick={(event) => {
            event.stopPropagation()
            onClick()
          }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left">{label}</TooltipContent>
    </Tooltip>
  )
}

export function ActivityNotificationClearAction({
  onClear
}: {
  onClear: () => void
}): React.JSX.Element {
  return (
    <ActivityNotificationAction
      label={translate(
        'auto.components.activity.ActivityThreadRow.clearNotification',
        'Clear notification'
      )}
      keyboardReachable
      onClick={onClear}
    >
      <X className="size-2.5" />
    </ActivityNotificationAction>
  )
}

export function ActivityNotificationReadAction({
  unread,
  onMarkRead,
  onMarkUnread,
  disableMarkUnread = false,
  readLabel = translate(
    'auto.components.activity.ActivityPrototypePage.markThreadRead',
    'Mark thread as read'
  ),
  unreadLabel = translate(
    'auto.components.activity.ActivityPrototypePage.59b131fbd9',
    'Mark thread unread'
  )
}: {
  unread: boolean
  onMarkRead: () => void
  onMarkUnread: () => void
  disableMarkUnread?: boolean
  readLabel?: string
  unreadLabel?: string
}): React.JSX.Element {
  return (
    <span className="inline-flex size-3.5 shrink-0 items-center justify-center">
      {unread ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onMarkRead()
              }}
              onMouseDown={(event) => event.stopPropagation()}
              className="flex size-3.5 shrink-0 cursor-pointer items-center justify-center rounded hover:bg-accent/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              aria-label={readLabel}
            >
              <FilledBellIcon
                className="size-3 shrink-0 text-amber-500 drop-shadow-sm"
                aria-hidden="true"
              />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">{readLabel}</TooltipContent>
        </Tooltip>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              disabled={disableMarkUnread}
              onClick={(event) => {
                event.stopPropagation()
                onMarkUnread()
              }}
              onMouseDown={(event) => event.stopPropagation()}
              className={cn(
                'flex size-3.5 shrink-0 cursor-pointer items-center justify-center rounded transition-opacity',
                'can-hover:opacity-0 can-hover:group-hover:opacity-100',
                'hover:bg-accent/80 active:scale-95',
                'focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
              )}
              aria-label={unreadLabel}
            >
              <Bell className="size-2.5 text-muted-foreground" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">{unreadLabel}</TooltipContent>
        </Tooltip>
      )}
    </span>
  )
}
