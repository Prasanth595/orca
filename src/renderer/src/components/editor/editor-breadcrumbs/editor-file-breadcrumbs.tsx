import { useCallback, useState } from 'react'
import { ChevronLeft, ChevronRight, File, Folder } from 'lucide-react'
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
  /** Full path this segment represents (dir or file). */
  fullPath: string
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
    segments.push({ label: part, fullPath: currentPath })
  }
  return segments
}

type SegmentPickerProps = {
  segment: Segment
  /** Directory whose siblings are shown when the picker first opens. */
  siblingDir: string
  worktreeId: string
  onNavigate: (filePath: string) => void
  /** Applies the filename styling (foreground + semi-bold). */
  isCurrentFile?: boolean
}

function SegmentPicker({
  segment,
  siblingDir,
  worktreeId,
  onNavigate,
  isCurrentFile
}: SegmentPickerProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [currentDir, setCurrentDir] = useState(siblingDir)
  const [entries, setEntries] = useState<DirEntry[] | null>(null)
  const [loading, setLoading] = useState(false)
  const worktreePath = useAppStore(
    (s) => getIndexedWorktreeById(s.worktreesByRepo, worktreeId)?.path ?? null
  )

  const loadDir = useCallback(
    async (dir: string) => {
      setLoading(true)
      try {
        const result = await readFileExplorerDirectory(worktreeId, worktreePath, dir)
        setEntries(result.entries)
      } catch {
        setEntries([])
      } finally {
        setLoading(false)
      }
    },
    [worktreeId, worktreePath]
  )

  const handleOpenChange = (next: boolean): void => {
    if (next) {
      // Reset to the sibling directory every time the picker opens.
      setCurrentDir(siblingDir)
      setEntries(null)
      void loadDir(siblingDir)
    }
    setOpen(next)
  }

  const drillDown = (dirPath: string): void => {
    setCurrentDir(dirPath)
    setEntries(null)
    void loadDir(dirPath)
  }

  const goUp = (): void => {
    const parent = dirname(currentDir)
    setCurrentDir(parent)
    setEntries(null)
    void loadDir(parent)
  }

  const isDrilled = currentDir !== siblingDir

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange} modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={`breadcrumb-segment${isCurrentFile ? ' breadcrumb-segment--file' : ''}`}
          aria-label={translate(
            'auto.components.editor.editorBreadcrumbs.fileBreadcrumbs.segmentLabel',
            'Navigate {{value0}}',
            { value0: segment.label }
          )}
        >
          {segment.label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64 max-h-72" align="start" sideOffset={4}>
        {isDrilled && (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault()
              goUp()
            }}
          >
            <ChevronLeft className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate text-muted-foreground">..</span>
          </DropdownMenuItem>
        )}
        {loading && (
          <div className="px-3 py-1.5 text-xs text-muted-foreground">
            {translate(
              'auto.components.editor.editorBreadcrumbs.fileBreadcrumbs.loading',
              'Loading…'
            )}
          </div>
        )}
        {entries?.map((entry) => {
          const entryPath = joinPath(currentDir, entry.name)
          // Highlight the current segment only when not drilled into a subdirectory.
          const isActive = !isDrilled && entryPath === segment.fullPath
          return (
            <DropdownMenuItem
              key={entry.name}
              active={isActive}
              onSelect={(e) => {
                if (entry.isDirectory) {
                  e.preventDefault()
                  drillDown(entryPath)
                } else {
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
              {entry.isDirectory && (
                <ChevronRight className="ml-auto size-3 shrink-0 text-muted-foreground" />
              )}
            </DropdownMenuItem>
          )
        })}
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
    <div
      className="breadcrumbs-file"
      aria-label={translate(
        'auto.components.editor.editorBreadcrumbs.fileBreadcrumbs.container',
        'File path'
      )}
    >
      {segments.map((segment, i) => {
        const isLast = i === segments.length - 1
        // siblingDir: for the first segment use worktreePath (or its own parent), for others use
        // the parent of this segment. The last segment (file) uses its own parent directory.
        const siblingDir =
          i === 0 ? (worktreePath ?? dirname(segment.fullPath)) : dirname(segment.fullPath)
        return (
          <span key={segment.fullPath} className="breadcrumb-item">
            {i > 0 && <ChevronRight className="breadcrumb-sep" aria-hidden />}
            <SegmentPicker
              segment={segment}
              siblingDir={siblingDir}
              worktreeId={activeFile.worktreeId}
              onNavigate={onNavigate}
              isCurrentFile={isLast}
            />
          </span>
        )
      })}
    </div>
  )
}
