import React from 'react'
import { useAppStore } from '@/store'
import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { isHierarchySidebarStyle, isSidebarStyle } from '../../../../shared/sidebar-style'

const KEY = 'auto.components.sidebar.SidebarWorkspaceOptionsMenu.sidebarStyle'

export function SidebarStyleMenuSub({
  preserveWorkspaceBoardOpen
}: {
  preserveWorkspaceBoardOpen: boolean
}): React.JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const style = isHierarchySidebarStyle(settings) ? 'hierarchy' : 'classic'
  const options = [
    { id: 'classic', label: translate(`${KEY}.classic`, 'Classic') },
    { id: 'hierarchy', label: translate(`${KEY}.hierarchy`, 'Hierarchy') }
  ]
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <span className="flex flex-1 items-center justify-between">
          <span>{translate(`${KEY}.title`, 'Sidebar style')}</span>
          <span className="text-[11px] font-medium text-muted-foreground">
            {options.find((opt) => opt.id === style)?.label}
          </span>
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        className="w-44"
        data-workspace-board-preserve-open={preserveWorkspaceBoardOpen ? '' : undefined}
      >
        <DropdownMenuRadioGroup
          value={style}
          onValueChange={(value) => {
            if (isSidebarStyle(value)) {
              void updateSettings({ sidebarStyle: value })
            }
          }}
        >
          {options.map((opt) => (
            <DropdownMenuRadioItem key={opt.id} value={opt.id} onSelect={(e) => e.preventDefault()}>
              {opt.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
