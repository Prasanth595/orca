import path from 'node:path'
import type { RuntimeMobileSessionClientTab } from '../../shared/runtime-types'
import type {
  RuntimeFileCloseOptions,
  RuntimeFileCloseResult
} from '../../shared/runtime-file-contracts'
import { isWindowsAbsolutePathLike } from '../../shared/cross-platform-path'
import { isSafeMobileRelativePath } from './runtime-file-command-host'

type FileCloseHost = {
  confirmClosePinnedTab?: boolean
  listTabs: (
    selector: string
  ) => Promise<{ worktree: string; tabs: RuntimeMobileSessionClientTab[] }>
  closeInRenderer?: (worktreeId: string, tabIds: string[], force: boolean) => Promise<void>
  closeHeadless: (worktreeId: string, tabId: string, force: boolean) => Promise<void>
}

export async function closeRuntimeFileTabs(
  host: FileCloseHost,
  selector: string,
  options: RuntimeFileCloseOptions
): Promise<RuntimeFileCloseResult> {
  if (Boolean(options.relativePath) === (options.all === true)) {
    throw new Error('Choose a file path or --all.')
  }
  if (options.relativePath && !isSafeMobileRelativePath(options.relativePath)) {
    throw new Error('File close requires a path inside the selected worktree.')
  }
  const snapshot = await host.listTabs(selector)
  const matchingFiles = snapshot.tabs.filter((tab) => {
    if (tab.type !== 'file' && tab.type !== 'markdown') {
      return false
    }
    if (options.all) {
      return true
    }
    const paths = isWindowsAbsolutePathLike(tab.filePath) ? path.win32 : path.posix
    return paths.normalize(tab.relativePath) === paths.normalize(options.relativePath ?? '')
  })
  const primaryFile =
    matchingFiles.find(
      (tab) =>
        (tab.type === 'file' || tab.type === 'markdown') &&
        (tab.mode === undefined || tab.mode === 'edit')
    ) ?? matchingFiles[0]
  const files = options.all ? matchingFiles : primaryFile ? [primaryFile] : []
  if (!options.all && files.length === 0) {
    throw new Error(`File tab not found: ${options.relativePath}`)
  }
  const force = options.force === true
  if (files.length > 0 && host.closeInRenderer) {
    await host.closeInRenderer(
      snapshot.worktree,
      files.map((tab) => tab.id),
      force
    )
  } else {
    // Headless hosts own persisted drafts; check the entire batch before retiring any tab.
    for (const tab of files) {
      if (!force && (tab.type === 'file' || tab.type === 'markdown')) {
        if (tab.isDirty) {
          throw new Error(`Unsaved changes: ${tab.relativePath}. Use --force to discard.`)
        }
        if (tab.isPinned && host.confirmClosePinnedTab !== false) {
          throw new Error(`Pinned file tab: ${tab.relativePath}. Use --force to close.`)
        }
      }
    }
    for (const tabId of new Set(files.map((tab) => tab.id))) {
      await host.closeHeadless(snapshot.worktree, tabId, force)
    }
  }
  return {
    worktree: snapshot.worktree,
    closed: files.flatMap((tab) =>
      tab.type === 'file' || tab.type === 'markdown' ? [tab.relativePath] : []
    )
  }
}
