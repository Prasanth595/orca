import React, { useId, useMemo } from 'react'
import { useAppStore } from '@/store'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { getComposerWorktreeCandidates } from '@/lib/composer-worktree-candidates'
import { translate } from '@/i18n/i18n'
import type { ExecutionHostId } from '../../../../shared/execution-host'

// Why: Radix Select reserves the empty string, and worktree ids never take this form.
const NEW_WORKSPACE_VALUE = 'new-workspace'

type NewWorkspaceComposerExistingWorkspaceFieldProps = {
  repoId: string
  executionHostId?: ExecutionHostId | null
  /** Null means a new workspace is created. */
  value: string | null
  onChange: (worktreeId: string | null) => void
  unavailableReason: string | null
}

/** Lets an opener's agent prompt run in one of the project's existing workspaces instead. */
export function NewWorkspaceComposerExistingWorkspaceField({
  repoId,
  executionHostId,
  value,
  onChange,
  unavailableReason
}: NewWorkspaceComposerExistingWorkspaceFieldProps): React.JSX.Element {
  const labelId = useId()
  const helpId = useId()
  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)
  const candidates = useMemo(
    () => getComposerWorktreeCandidates(worktreesByRepo, { repoId, executionHostId }),
    [executionHostId, repoId, worktreesByRepo]
  )
  const selected =
    value !== null && candidates.some((candidate) => candidate.id === value)
      ? value
      : NEW_WORKSPACE_VALUE

  return (
    <div className="min-w-0 space-y-1">
      <span id={labelId} className="block text-xs font-medium text-muted-foreground">
        {translate('auto.components.NewWorkspaceComposerCard.runInLabel', 'Run in')}
      </span>
      <Select
        value={selected}
        onValueChange={(next) => onChange(next === NEW_WORKSPACE_VALUE ? null : next)}
        disabled={unavailableReason !== null}
      >
        <SelectTrigger aria-labelledby={labelId} aria-describedby={helpId} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NEW_WORKSPACE_VALUE}>
            {translate(
              'auto.components.NewWorkspaceComposerCard.runInNewWorkspace',
              'New workspace'
            )}
          </SelectItem>
          {candidates.map((candidate) => (
            <SelectItem key={candidate.id} value={candidate.id}>
              {candidate.displayName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p id={helpId} className="text-[11px] text-muted-foreground">
        {unavailableReason ??
          (selected === NEW_WORKSPACE_VALUE
            ? translate(
                'auto.components.NewWorkspaceComposerCard.runInNewWorkspaceHelp',
                'Creates a workspace and starts the agent there.'
              )
            : translate(
                'auto.components.NewWorkspaceComposerCard.runInExistingWorkspaceHelp',
                'Opens an agent tab in this workspace instead of creating one.'
              ))}
      </p>
    </div>
  )
}
