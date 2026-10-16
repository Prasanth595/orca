import React from 'react'
import { FolderOpen, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { displayPathInsideWorktree } from './nested-folder-paths'
import type { NestedFolderScope } from './use-nested-folder-scope'

export function NestedFolderPicker({
  worktreePath,
  scope
}: {
  worktreePath: string
  scope: NestedFolderScope
}): React.JSX.Element {
  const folderLabel = scope.folderPath
    ? displayPathInsideWorktree(worktreePath, scope.folderPath)
    : translate('sourceControl.nestedFolder.workspaceRoot', 'This workspace')

  const pickFolder = async (): Promise<void> => {
    const picked = await window.api.shell.pickDirectory({
      defaultPath: scope.folderPath ?? worktreePath
    })
    if (picked) {
      scope.setFolderPath(picked)
    }
  }

  return (
    <div className="flex min-w-0 items-center gap-1 px-3 pb-1 pt-0.5">
      <Button
        type="button"
        variant="outline"
        size="xs"
        className="h-6 min-w-0 flex-1 justify-start gap-1 px-2 text-[11px] font-normal"
        onClick={() => void pickFolder()}
        title={translate('sourceControl.nestedFolder.pickTitle', 'Show git repos inside a folder')}
      >
        <FolderOpen className="size-3 shrink-0" aria-hidden="true" />
        <span className="min-w-0 truncate">{folderLabel}</span>
      </Button>
      {scope.folderPath ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="size-6 shrink-0 text-muted-foreground"
          aria-label={translate('sourceControl.nestedFolder.clear', 'Clear folder')}
          title={translate('sourceControl.nestedFolder.clear', 'Clear folder')}
          onClick={() => scope.setFolderPath(null)}
        >
          <X className="size-3.5" />
        </Button>
      ) : null}
    </div>
  )
}
