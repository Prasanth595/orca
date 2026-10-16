import React from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { NestedFolderScope } from './use-nested-folder-scope'

export function NestedRepoList({ scope }: { scope: NestedFolderScope }): React.JSX.Element | null {
  if (!scope.folderPath) {
    return null
  }

  if (scope.scanning && scope.statuses.length === 0) {
    return (
      <div className="flex items-center gap-1.5 px-3 py-2 text-[11px] text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        {translate('sourceControl.nestedFolder.scanning', 'Looking for git repos…')}
      </div>
    )
  }

  if (scope.scanError) {
    return <p className="px-3 py-2 text-[11px] text-destructive">{scope.scanError}</p>
  }

  if (scope.repos.length === 0) {
    return (
      <p className="px-3 py-2 text-[11px] text-muted-foreground">
        {translate('sourceControl.nestedFolder.empty', 'No git repos in this folder')}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-1 px-2 pb-1">
      <p className="px-2 text-[10px] text-muted-foreground">
        {translate(
          'sourceControl.nestedFolder.commitHint',
          'Commit and Create PR use the selected repo'
        )}
      </p>
      {scope.statuses.map((entry) => {
        const selected = entry.repo.path === scope.selectedRepoPath
        const files = entry.status?.entries ?? []
        const branch = entry.status?.branch
        return (
          <div key={entry.repo.path} className="min-w-0">
            <button
              type="button"
              data-current={selected ? 'true' : undefined}
              className={cn(
                'flex w-full min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-left text-[11.5px] hover:bg-accent',
                selected && 'bg-accent'
              )}
              onClick={() => scope.selectRepo(entry.repo.path)}
            >
              <span className="min-w-0 flex-1 truncate font-medium">{entry.repo.displayName}</span>
              {branch ? (
                <span className="max-w-[40%] truncate text-muted-foreground">{branch}</span>
              ) : null}
              <span className="shrink-0 tabular-nums text-muted-foreground">{files.length}</span>
            </button>
            {files.length > 0 ? (
              <ul className="px-2 pb-1">
                {files.map((file) => (
                  <li
                    key={file.path}
                    className="truncate text-[11px] text-muted-foreground"
                    title={file.path}
                  >
                    {file.path}
                  </li>
                ))}
              </ul>
            ) : null}
            {entry.error ? (
              <p className="px-2 pb-1 text-[11px] text-destructive">{entry.error}</p>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
