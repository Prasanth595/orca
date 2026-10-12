import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { useConfirmationDialog } from '@/components/confirmation-dialog-context'
import {
  requestEditorSaveQuiesce,
  notifyEditorExternalFileChange
} from '@/components/editor/editor-autosave'
import { listRuntimeGitStashes, stashRuntimeGit } from '@/runtime/runtime-git-stash-client'
import type { RuntimeGitContext } from '@/runtime/runtime-git-client-context'
import type { GitStashEntry, GitStashOptions } from '../../../../../../shared/git-stash'
import { requireGitOwnerTarget } from '../../worktree-git-owner-target'
import type { SourceControlPanelFoundation } from '../panel/use-panel-foundation'
import { refreshSourceControlAfterRemoteAction } from '../sync/remote-refresh'
import type { StashMenuAction } from './stash-menu'
import { createStashEditorMutationTarget } from './stash-editor-mutation'

type StashActionsFoundation = Pick<
  SourceControlPanelFoundation,
  | 'activeRepoTarget'
  | 'activeWorktreeId'
  | 'activeConnectionId'
  | 'worktreePath'
  | 'grouped'
  | 'isCommitting'
  | 'isAbortingOperation'
  | 'unresolvedConflicts'
  | 'setRemoteActionErrors'
  | 'refreshActiveGitStatusAfterMutation'
  | 'refreshBranchCompareRef'
  | 'refreshGitHistoryRef'
>

export type StashPickerState = {
  action: 'apply' | 'pop' | 'drop' | 'show'
  context: RuntimeGitContext
  entries: GitStashEntry[]
  loading: boolean
  error: string | null
  truncated: boolean
}
export type StashSaveState = {
  action: 'push' | 'push_untracked' | 'push_staged'
  context: RuntimeGitContext
}
export type StashViewState = { stash: GitStashEntry; output: string; worktreePath?: string | null }

export function useSourceControlStashActions(foundation: StashActionsFoundation) {
  const {
    activeRepoTarget,
    activeWorktreeId,
    activeConnectionId,
    worktreePath,
    grouped,
    isCommitting,
    isAbortingOperation,
    unresolvedConflicts,
    setRemoteActionErrors,
    refreshActiveGitStatusAfterMutation,
    refreshBranchCompareRef,
    refreshGitHistoryRef
  } = foundation
  const confirmAction = useConfirmationDialog()
  const [picker, setPicker] = useState<StashPickerState | null>(null)
  const [save, setSave] = useState<StashSaveState | null>(null)
  const [view, setView] = useState<StashViewState | null>(null)
  const [busy, setBusy] = useState(false)
  const scopeKey = JSON.stringify([activeWorktreeId, activeRepoTarget, worktreePath])
  const [dialogScopeKey, setDialogScopeKey] = useState(scopeKey)
  if (dialogScopeKey !== scopeKey) {
    setDialogScopeKey(scopeKey)
    setPicker(null)
    setSave(null)
    setView(null)
  }
  const inFlight = useRef(false)
  const revision = useRef(0)
  useEffect(() => {
    revision.current += 1
  }, [scopeKey])

  const run = useCallback(
    async (context: RuntimeGitContext, request: GitStashOptions) => {
      const store = useAppStore.getState()
      if (
        inFlight.current ||
        store.isRemoteOperationActive ||
        isCommitting ||
        isAbortingOperation
      ) {
        return
      }
      const version = revision.current
      inFlight.current = true
      setBusy(true)
      store.beginRemoteOperation()
      const mutatesFiles =
        request.action.startsWith('push') || request.action === 'apply' || request.action === 'pop'
      const editorTarget = mutatesFiles ? createStashEditorMutationTarget(context) : null
      if (context.worktreeId) {
        const id = context.worktreeId
        setRemoteActionErrors((prev) => ({ ...prev, [id]: null }))
      }
      try {
        // Quiesce autosaves so delayed writes cannot restore edits removed by Stash.
        if (editorTarget) {
          await requestEditorSaveQuiesce(editorTarget)
        }
        const result = await stashRuntimeGit(context, request)
        if (request.action === 'show' && request.stash) {
          if (version === revision.current) {
            setView({
              stash: request.stash,
              output: result.output,
              worktreePath: context.worktreePath
            })
            setPicker(null)
          }
        } else {
          if (version === revision.current) {
            setPicker(null)
            setSave(null)
          }
          toast.success(translate('sourceControl.stash.completed', 'Stash operation completed'), {
            description: result.output.split('\n')[0] || undefined
          })
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        toast.error(translate('sourceControl.stash.failed', 'Stash operation failed'), {
          description: message
        })
        if (context.worktreeId) {
          const id = context.worktreeId
          setRemoteActionErrors((prev) => ({
            ...prev,
            [id]: { kind: 'stash', message, rawError: message }
          }))
        }
      } finally {
        if (editorTarget) {
          notifyEditorExternalFileChange(editorTarget)
        }
        inFlight.current = false
        setBusy(false)
        store.endRemoteOperation()
        if (request.action !== 'show') {
          refreshSourceControlAfterRemoteAction({
            refreshGitStatus: refreshActiveGitStatusAfterMutation,
            refreshBranchCompare: refreshBranchCompareRef.current,
            refreshGitHistory: refreshGitHistoryRef.current
          })
        }
      }
    },
    [
      isCommitting,
      isAbortingOperation,
      setRemoteActionErrors,
      refreshActiveGitStatusAfterMutation,
      refreshBranchCompareRef,
      refreshGitHistoryRef
    ]
  )

  const requestStashAction = useCallback(
    async (action: StashMenuAction) => {
      if (
        !activeWorktreeId ||
        !worktreePath ||
        inFlight.current ||
        useAppStore.getState().isRemoteOperationActive ||
        isCommitting ||
        isAbortingOperation
      ) {
        return
      }
      const version = ++revision.current
      try {
        const context = {
          target: requireGitOwnerTarget(activeRepoTarget),
          worktreeId: activeWorktreeId,
          worktreePath,
          connectionId: activeConnectionId ?? undefined
        }
        if (action === 'push' || action === 'push_untracked' || action === 'push_staged') {
          setSave({ action, context })
          return
        }
        const isPicker =
          action === 'apply' || action === 'pop' || action === 'drop' || action === 'show'
        if (isPicker) {
          setPicker({ action, context, entries: [], loading: true, error: null, truncated: false })
        }
        const result = await listRuntimeGitStashes(context)
        if (version !== revision.current) {
          return
        }
        if (isPicker) {
          setPicker({ action, context, ...result, loading: false, error: null })
          return
        }
        const latest = result.entries[0]
        if (!latest) {
          toast.info(translate('sourceControl.stash.empty', 'No stashes found'))
          return
        }
        if (action === 'clear') {
          if (result.truncated) {
            throw new Error('More than 200 stashes found. Drop individual stashes first.')
          }
          const confirmed = await confirmAction({
            title: translate('sourceControl.stash.dropAllTitle', 'Drop all stashes?'),
            description: translate(
              'sourceControl.stash.dropAllDescription',
              'Delete all {{count}} stashes in this repository. All worktrees share this stash list.',
              { count: result.entries.length }
            ),
            confirmLabel: translate('sourceControl.stash.dropAll', 'Drop All Stashes'),
            confirmVariant: 'destructive'
          })
          if (confirmed && version === revision.current) {
            await run(context, {
              action: 'clear',
              expectedStashes: result.entries.map((entry) => entry.oid)
            })
          }
        } else {
          await run(context, { action: action === 'apply_last' ? 'apply' : 'pop', stash: latest })
        }
      } catch (error) {
        if (version !== revision.current) {
          return
        }
        const message = error instanceof Error ? error.message : String(error)
        setPicker((prev) => (prev ? { ...prev, loading: false, error: message } : null))
        toast.error(translate('sourceControl.stash.failed', 'Stash operation failed'), {
          description: message
        })
      }
    },
    [
      activeRepoTarget,
      activeWorktreeId,
      activeConnectionId,
      worktreePath,
      isCommitting,
      isAbortingOperation,
      confirmAction,
      run
    ]
  )

  const selectStash = useCallback(
    async (stash: GitStashEntry) => {
      if (!picker || busy) {
        return
      }
      const version = revision.current
      if (picker.action === 'drop') {
        const confirmed = await confirmAction({
          title: translate('sourceControl.stash.dropTitle', 'Drop this stash?'),
          description: `${stash.ref}: ${stash.subject}`,
          confirmLabel: translate('sourceControl.stash.drop', 'Drop Stash'),
          confirmVariant: 'destructive'
        })
        if (!confirmed || version !== revision.current) {
          return
        }
      }
      await run(picker.context, { action: picker.action, stash })
    },
    [picker, busy, confirmAction, run]
  )

  return {
    picker,
    save,
    view,
    busy,
    setPicker,
    setSave,
    setView,
    selectStash,
    requestStashAction,
    saveStash: (message: string) =>
      save ? run(save.context, { action: save.action, message }) : Promise.resolve(),
    canStash:
      unresolvedConflicts.length === 0 &&
      (grouped.staged.length > 0 || grouped.unstaged.length > 0),
    canStashUntracked:
      unresolvedConflicts.length === 0 &&
      (grouped.staged.length > 0 || grouped.unstaged.length > 0 || grouped.untracked.length > 0),
    canStashStaged: unresolvedConflicts.length === 0 && grouped.staged.length > 0,
    hasConflicts: unresolvedConflicts.length > 0
  }
}

export type SourceControlStashActions = ReturnType<typeof useSourceControlStashActions>
