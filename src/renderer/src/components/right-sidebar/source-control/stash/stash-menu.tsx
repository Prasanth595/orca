import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import type { SourceControlStashActions } from './use-stash-actions'

export type StashMenuAction =
  | 'push'
  | 'push_untracked'
  | 'push_staged'
  | 'apply_last'
  | 'apply'
  | 'pop_last'
  | 'pop'
  | 'drop'
  | 'clear'
  | 'show'

function getStashMenuGroups(): { action: StashMenuAction; label: string }[][] {
  return [
    [
      { action: 'push', label: translate('sourceControl.stash.action.push', 'Stash') },
      {
        action: 'push_untracked',
        label: translate('sourceControl.stash.action.push_untracked', 'Stash (Include Untracked)')
      },
      {
        action: 'push_staged',
        label: translate('sourceControl.stash.action.push_staged', 'Stash Staged')
      }
    ],
    [
      {
        action: 'apply_last',
        label: translate('sourceControl.stash.action.apply_last', 'Apply Last Stash')
      },
      { action: 'apply', label: translate('sourceControl.stash.action.apply', 'Apply Stash…') }
    ],
    [
      {
        action: 'pop_last',
        label: translate('sourceControl.stash.action.pop_last', 'Pop Last Stash')
      },
      { action: 'pop', label: translate('sourceControl.stash.action.pop', 'Pop Stash…') }
    ],
    [
      { action: 'drop', label: translate('sourceControl.stash.action.drop', 'Drop Stash…') },
      { action: 'clear', label: translate('sourceControl.stash.action.clear', 'Drop All Stashes…') }
    ],
    [{ action: 'show', label: translate('sourceControl.stash.action.show', 'View Stash…') }]
  ]
}

export function StashMenu({
  disabled,
  actions
}: {
  disabled: boolean
  actions?: SourceControlStashActions
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={disabled || !actions}>
        {translate('sourceControl.stash.menu', 'Stash')}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {getStashMenuGroups().map((group, index) => (
          <div key={group[0]?.action}>
            {index > 0 ? <DropdownMenuSeparator /> : null}
            {group.map(({ action, label }) => (
              <DropdownMenuItem
                key={action}
                variant={action === 'drop' || action === 'clear' ? 'destructive' : 'default'}
                disabled={
                  disabled ||
                  !actions ||
                  (action === 'push_staged'
                    ? !actions.canStashStaged
                    : action === 'push_untracked'
                      ? !actions.canStashUntracked
                      : action === 'push'
                        ? !actions.canStash
                        : (action === 'apply' ||
                            action === 'apply_last' ||
                            action === 'pop' ||
                            action === 'pop_last') &&
                          actions.hasConflicts)
                }
                onSelect={() => void actions?.requestStashAction(action)}
              >
                {label}
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
