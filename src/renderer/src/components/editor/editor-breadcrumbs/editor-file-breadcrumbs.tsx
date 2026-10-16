import { useCallback, useState } from 'react'
import { ChevronRight, File, Folder } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useAppStore } from '@/store'
import type { OpenFile } from '@/store/slices/editor'
import { getIndexedWorktreeById } from '@/store/worktree-repo-index'
import { dirname, joinPath } from '@/lib/path'
import { readFileExplorerDirectory } from '@/components/right-sidebar/file-explorer-directory-listing'
import { translate } from '@/i18n/i18n'

type Segment = {
  label: string
  dirPath: string
}

type DirEntry = {
  name: string
  isDirectory: boolean
}

function splitIntoSegments(filePath: string, worktreePath: string | null): Segment[] {
  const sep = filePath.includes('\\') ? '\\' : '/'
  const rel =
    worktreePath && filePath.startsWith(worktreePath)
      ? filePath.slice(worktreePath.length).replace(/^[\\/]/, '')
      : filePath
  const parts = rel.split(/[\\/]/).filter(Boolean)
  const segments: Segment[] = []
  let currentPath = worktreePath ?? ''
  for (const part of parts) {
    currentPath = currentPath ? `${currentPath}${sep}${part}` : part
    segments.push({ label: part, dirPath: currentPath })
  }
  return segments
}

type SegmentPickerProps = {
  segment: Segment
  parentDir: string
  worktreeId: string
  onNavigate: (filePath: string) => void
}

function SegmentPicker({
  segment,
  parentDir,
  worktreeId,
  onNavigate
}: SegmentPickerProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<DirEntry[] | null>(null)
  const [loading, setLoading] = useState(false)
  const worktreePath = useAppStore(
    (s) => getIndexedWorktreeById(s.worktreesByRepo, worktreeId)?.path ?? null
  )

  const loadEntries = useCallback(async () => {
    if (loading || entries !== null) {
      return
    }
    setLoading(true)
    try {
      const result = await readFileExplorerDirectory(worktreeId, worktreePath, parentDir)
      setEntries(result.entries)
    } catch {
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [entries, loading, parentDir, worktreeId, worktreePath])

  const handleOpenChange = (next: boolean): void => {
    setOpen(next)
    if (next) {
      void loadEntries()
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange} modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="breadcrumb-segment"
          aria-label={translate(
            'auto.components.editor.editorBreadcrumbs.fileBreadcrumbs.segmentLabel',
            'Navigate {{value0}}',
            { value0: segment.label }
          )}
        >
          {segment.label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64 p-0" align="start" sideOffset={4}>
        <div className="max-h-72 overflow-y-auto scrollbar-sleek p-1">
          {loading && (
            <div className="px-3 py-1.5 text-xs text-muted-foreground">
              {translate(
                'auto.components.editor.editorBreadcrumbs.fileBreadcrumbs.loading',
                'Loading…'
              )}
            </div>
          )}
          {entries?.map((entry) => {
            const entryPath = joinPath(parentDir, entry.name)
            const isActive = entryPath === segment.dirPath
            return (
              <DropdownMenuItem
                key={entry.name}
                active={isActive}
                onSelect={() => {
                  if (!entry.isDirectory) {
                    onNavigate(entryPath)
                  }
                }}
              >
                {entry.isDirectory ? (
                  <Folder className="size-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <File className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate">{entry.name}</span>
              </DropdownMenuItem>
            )
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

type EditorFileBreadcrumbsProps = {
  activeFile: OpenFile
  onNavigate: (filePath: string) => void
}

export function EditorFileBreadcrumbs({
  activeFile,
  onNavigate
}: EditorFileBreadcrumbsProps): React.JSX.Element {
  const worktreePath = useAppStore(
    (s) => getIndexedWorktreeById(s.worktreesByRepo, activeFile.worktreeId)?.path ?? null
  )
  const segments = splitIntoSegments(activeFile.filePath, worktreePath)

  return (
    <div className="breadcrumbs-file" aria-label="File path">
      {segments.map((segment, i) => {
        const isLast = i === segments.length - 1
        const parentDir =
          i === 0 ? (worktreePath ?? dirname(segment.dirPath)) : dirname(segment.dirPath)
        return (
          <span key={segment.dirPath} className="breadcrumb-item">
            {i > 0 && <ChevronRight className="breadcrumb-sep" aria-hidden />}
            {isLast ? (
              <span className="breadcrumb-segment breadcrumb-segment--file">{segment.label}</span>
            ) : (
              <SegmentPicker
                segment={segment}
                parentDir={parentDir}
                worktreeId={activeFile.worktreeId}
                onNavigate={onNavigate}
              />
            )}
          </span>
        )
      })}
    </div>
  )
}
