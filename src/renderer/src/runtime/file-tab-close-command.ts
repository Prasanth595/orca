import type { AppState } from '../store/types'

export function closeFileTabsInStore(
  store: AppState,
  worktreeId: string,
  tabIds: readonly string[],
  force: boolean
): void {
  const tabs = store.unifiedTabsByWorktree[worktreeId] ?? []
  const files = tabIds.map((tabId) => {
    const tab = tabs.find((candidate) => candidate.id === tabId || candidate.entityId === tabId)
    const file = store.openFiles.find(
      (candidate) =>
        candidate.worktreeId === worktreeId && candidate.id === (tab?.entityId ?? tabId)
    )
    if (!file) {
      throw new Error(`File tab not found: ${tabId}`)
    }
    if (!force && (file.isDirty || file.id in store.editorDrafts)) {
      throw new Error(`Unsaved changes: ${file.relativePath}. Use --force to discard.`)
    }
    if (
      !force &&
      (store.settings?.confirmClosePinnedTab ?? true) &&
      tabs.some((candidate) => candidate.entityId === file.id && candidate.isPinned)
    ) {
      throw new Error(`Pinned file tab: ${file.relativePath}. Use --force to close.`)
    }
    return file
  })
  // Preflight every draft before the UI transaction removes any member of a batch.
  for (const fileId of new Set(files.map((file) => file.id))) {
    store.closeFile(fileId)
  }
}
