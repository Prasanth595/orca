import type { EditorPathMutationTarget } from '@/components/editor/editor-autosave'
import type { RuntimeGitContext } from '@/runtime/runtime-git-client-context'

export function createStashEditorMutationTarget(
  context: RuntimeGitContext
): EditorPathMutationTarget | null {
  if (!context.worktreeId || !context.worktreePath) {
    return null
  }
  const runtimeEnvironmentId =
    context.target.kind === 'environment' ? context.target.environmentId : null
  return {
    worktreeId: context.worktreeId,
    worktreePath: context.worktreePath,
    relativePath: '',
    runtimeEnvironmentId,
    indexedOpenFiles: {
      matches: (files) =>
        files.filter(
          (file) =>
            file.worktreeId === context.worktreeId &&
            (file.runtimeEnvironmentId?.trim() || null) === runtimeEnvironmentId
        )
    }
  }
}
