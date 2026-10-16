import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { translate } from '@/i18n/i18n'
import type { NestedRepoCandidate } from '../../../../../../shared/project-group-types'
import type { GitStatusEntry, GitStatusResult } from '../../../../../../shared/git-status-types'
import {
  NESTED_REPO_SCAN_OPTIONS,
  folderPathIsInsideWorktree,
  selectDefaultNestedRepo
} from './nested-folder-paths'

const folderPathByWorktree = new Map<string, string>()
const STATUS_CONCURRENCY = 4

export type NestedRepoStatus = {
  repo: NestedRepoCandidate
  status: GitStatusResult | null
  error: string | null
}

export type NestedFolderScope = {
  folderPath: string | null
  repos: NestedRepoCandidate[]
  statuses: NestedRepoStatus[]
  selectedRepoPath: string | null
  scanning: boolean
  scanError: string | null
  gitTargetPath: string | null
  gitTargetEntries: GitStatusEntry[] | null
  gitTargetBranch: string | null
  setFolderPath: (path: string | null) => void
  selectRepo: (path: string) => void
  refreshAll: () => Promise<void>
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> {
  const results = Array.from({ length: items.length }) as R[]
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++
      results[index] = await mapper(items[index]!)
    }
  })
  await Promise.all(workers)
  return results
}

export function useNestedFolderScope({
  worktreeId,
  worktreePath,
  connectionId
}: {
  worktreeId: string | null
  worktreePath: string | null
  connectionId: string | null
}): NestedFolderScope {
  const [folderPath, setFolderPathState] = useState<string | null>(() =>
    worktreeId ? (folderPathByWorktree.get(worktreeId) ?? null) : null
  )
  const [repos, setRepos] = useState<NestedRepoCandidate[]>([])
  const [statuses, setStatuses] = useState<NestedRepoStatus[]>([])
  const [selectedRepoPath, setSelectedRepoPath] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const requestGeneration = useRef(0)

  useEffect(() => {
    const restored = worktreeId ? (folderPathByWorktree.get(worktreeId) ?? null) : null
    setFolderPathState(restored)
    setRepos([])
    setStatuses([])
    setSelectedRepoPath(null)
    setScanError(null)
  }, [worktreeId])

  const setFolderPath = useCallback(
    (path: string | null) => {
      if (!worktreeId) {
        return
      }
      if (path && worktreePath && !folderPathIsInsideWorktree(worktreePath, path)) {
        setScanError(
          translate(
            'sourceControl.nestedFolder.outsideWorkspace',
            'Selected folder is outside this workspace'
          )
        )
        return
      }
      if (path) {
        folderPathByWorktree.set(worktreeId, path)
      } else {
        folderPathByWorktree.delete(worktreeId)
      }
      setFolderPathState(path)
      setSelectedRepoPath(null)
      setScanError(null)
    },
    [worktreeId, worktreePath]
  )

  const refreshAll = useCallback(async (): Promise<void> => {
    if (!folderPath || !worktreePath) {
      setRepos([])
      setStatuses([])
      return
    }
    const generation = ++requestGeneration.current
    setScanning(true)
    setScanError(null)
    try {
      const scan = await window.api.projectGroups.scanNested({
        path: folderPath,
        ...(connectionId ? { connectionId } : {}),
        options: { ...NESTED_REPO_SCAN_OPTIONS }
      })
      if (generation !== requestGeneration.current) {
        return
      }
      const discovered = scan.repos
      setRepos(discovered)
      const nextStatuses = await mapWithConcurrency(
        discovered,
        STATUS_CONCURRENCY,
        async (repo) => {
          try {
            const status = await window.api.git.status({
              worktreePath: repo.path,
              ...(connectionId ? { connectionId } : {})
            })
            return { repo, status, error: null }
          } catch (error) {
            return {
              repo,
              status: null,
              error: error instanceof Error ? error.message : 'Failed to read git status'
            }
          }
        }
      )
      if (generation !== requestGeneration.current) {
        return
      }
      setStatuses(nextStatuses)
      const changeCountByPath = new Map(
        nextStatuses.map((entry) => [entry.repo.path, entry.status?.entries.length ?? 0])
      )
      setSelectedRepoPath((current) => {
        if (current && discovered.some((repo) => repo.path === current)) {
          return current
        }
        return selectDefaultNestedRepo(discovered, changeCountByPath)
      })
    } catch (error) {
      if (generation !== requestGeneration.current) {
        return
      }
      setRepos([])
      setStatuses([])
      setScanError(error instanceof Error ? error.message : 'Failed to scan nested repositories')
    } finally {
      if (generation === requestGeneration.current) {
        setScanning(false)
      }
    }
  }, [connectionId, folderPath, worktreePath])

  useEffect(() => {
    void refreshAll()
  }, [refreshAll])

  const selectedStatus = useMemo(
    () => statuses.find((entry) => entry.repo.path === selectedRepoPath) ?? null,
    [selectedRepoPath, statuses]
  )

  return {
    folderPath,
    repos,
    statuses,
    selectedRepoPath,
    scanning,
    scanError,
    gitTargetPath: selectedRepoPath,
    gitTargetEntries: selectedStatus?.status?.entries ?? (selectedRepoPath ? [] : null),
    gitTargetBranch: selectedStatus?.status?.branch ?? null,
    setFolderPath,
    selectRepo: setSelectedRepoPath,
    refreshAll
  }
}
