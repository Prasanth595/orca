import React from 'react'
import { ListFilter } from 'lucide-react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { isHierarchySidebarStyle } from '../../../../shared/sidebar-style'

export function SidebarActiveOnlyToggle(): React.JSX.Element | null {
  const hierarchyStyle = useAppStore((s) => isHierarchySidebarStyle(s.settings))
  const activeOnly = useAppStore((s) => s.sidebarActiveOnly)
  const setActiveOnly = useAppStore((s) => s.setSidebarActiveOnly)
  const visibleCount = useAppStore((s) => s.sidebarActiveOnlyVisibleCount)
  if (!hierarchyStyle) {
    return null
  }
  const label = translate('dashboard.sidebar.activeOnly.label', 'Active')
  const tooltip = activeOnly
    ? translate('dashboard.sidebar.activeOnly.turnOff', 'Show all workspaces')
    : translate(
        'dashboard.sidebar.activeOnly.turnOn',
        'Show only workspaces with open tabs or a live agent, plus pinned ones and the one you are in'
      )
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={activeOnly ? 'outline' : 'ghost'}
          size="xs"
          aria-pressed={activeOnly}
          onClick={() => setActiveOnly(!activeOnly)}
        >
          {/* Why muted children: off, the pill must sit as quietly as the icon buttons beside it. */}
          <ListFilter className={cn('size-3', !activeOnly && 'text-muted-foreground')} />
          <span className={cn(!activeOnly && 'text-muted-foreground')}>{label}</span>
          {activeOnly ? (
            <span className="tabular-nums text-muted-foreground">{visibleCount}</span>
          ) : null}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  )
}
