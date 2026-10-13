import React from 'react'
import { Folder, RotateCcw } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { RepoIconGlyph } from '@/components/repo/repo-icon'
import { RepositoryIconTabs } from '@/components/settings/RepositoryIconTabs'
import { translate } from '@/i18n/i18n'
import type { RepoIcon } from '../../../../shared/repo-icon'

// Why: groups reuse the project icon picker and RepoIcon shape, minus the GitHub-avatar source.
export function ProjectGroupIconDialog({
  open,
  groupName,
  icon,
  onOpenChange,
  onSetIcon
}: {
  open: boolean
  groupName: string
  icon: RepoIcon | null
  onOpenChange: (open: boolean) => void
  onSetIcon: (icon: RepoIcon | null) => void
}): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {translate('auto.components.sidebar.ProjectGroupIconDialog.title', 'Group Icon')}
          </DialogTitle>
          <DialogDescription>
            {translate(
              'auto.components.sidebar.ProjectGroupIconDialog.description',
              'Choose the icon shown next to {{value0}} in the sidebar.',
              { value0: groupName }
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-3">
          {icon ? (
            <RepoIconGlyph
              repoIcon={icon}
              className="size-10 shrink-0 rounded-md border border-border/70 bg-muted/30"
              iconClassName="size-5"
            />
          ) : (
            <span className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border/70 bg-muted/30 text-muted-foreground">
              <Folder className="size-5" />
            </span>
          )}
          <div className="min-w-0 flex-1 truncate text-sm font-semibold">{groupName}</div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={!icon}
            onClick={() => onSetIcon(null)}
          >
            <RotateCcw className="size-3.5" />
            {translate('auto.components.settings.RepositoryIconPicker.549d126081', 'Reset')}
          </Button>
        </div>
        <RepositoryIconTabs
          key={open ? 'open' : 'closed'}
          initialTab={
            icon?.type === 'emoji' ? 'emoji' : icon?.type === 'lucide' ? 'icon' : 'avatar'
          }
          selectedLucideName={icon?.type === 'lucide' ? icon.name : null}
          selectedEmoji={icon?.type === 'emoji' ? icon.emoji : ''}
          loadingGitHub={false}
          onSetIcon={onSetIcon}
        />
        <DialogFooter>
          <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
            {translate('auto.components.sidebar.ProjectGroupIconDialog.done', 'Done')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
