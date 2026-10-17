import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { detectLanguage } from '@/lib/language-detect'
import { joinPath } from '@/lib/path'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { perforceClient } from '@/runtime/runtime-perforce-client'
import { toSubmittedDiffPath } from '../../../../../shared/perforce/perforce-submitted-paths'
import type {
  PerforceFileAction,
  PerforceHistoryEntry,
  PerforceSubmittedFile
} from '../../../../../shared/perforce/perforce-types'
import type { PerforceTarget } from './use-perforce-status'

// ─── helpers ────────────────────────────────────────────────────────────────

const ACTION_LABEL: Partial<Record<PerforceFileAction, string>> = {
  add: 'A',
  edit: 'M',
  delete: 'D',
  branch: 'B',
  integrate: 'I',
  'move/add': 'R',
  'move/delete': 'D'
}

const ACTION_COLOR: Partial<Record<PerforceFileAction, string>> = {
  add: 'var(--git-decoration-added)',
  edit: 'var(--git-decoration-modified)',
  delete: 'var(--git-decoration-deleted)',
  'move/add': 'var(--git-decoration-renamed)',
  'move/delete': 'var(--git-decoration-deleted)'
}

function relativeTime(unixSeconds: number): string {
  const elapsed = Math.max(0, Date.now() / 1000 - unixSeconds)
  if (elapsed < 60) {
    return 'just now'
  }
  if (elapsed < 3600) {
    return `${Math.floor(elapsed / 60)}m ago`
  }
  if (elapsed < 86400) {
    return `${Math.floor(elapsed / 3600)}h ago`
  }
  if (elapsed < 86400 * 30) {
    return `${Math.floor(elapsed / 86400)}d ago`
  }
  if (elapsed < 86400 * 365) {
    return `${Math.floor(elapsed / (86400 * 30))}mo ago`
  }
  return `${Math.floor(elapsed / (86400 * 365))}y ago`
}

function depotBasename(depotPath: string): { name: string; dir: string } {
  const slash = depotPath.lastIndexOf('/')
  return {
    name: depotPath.slice(slash + 1),
    dir: slash <= 1 ? '' : depotPath.slice(0, slash)
  }
}

// ─── file row inside an expanded CL ─────────────────────────────────────────

function SubmittedFileRow({ file, onOpen }: { file: PerforceSubmittedFile; onOpen: () => void }) {
  const { name, dir } = depotBasename(file.depotPath)
  const label = ACTION_LABEL[file.action] ?? '?'
  const color = ACTION_COLOR[file.action]
  return (
    <button
      type="button"
      className="flex w-full min-w-0 items-center gap-2 py-0.5 pl-7 pr-2 text-left text-[13px] hover:bg-accent"
      onClick={onOpen}
      title={file.depotPath}
    >
      <span className="w-3 shrink-0 text-center text-[11px] font-semibold" style={{ color }}>
        {label}
      </span>
      <span className="truncate">{name}</span>
      {dir ? <span className="truncate text-xs text-muted-foreground">{dir}</span> : null}
    </button>
  )
}

// ─── single CL row with lazy-loaded files ────────────────────────────────────

type FilesState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; files: PerforceSubmittedFile[] }
  | { kind: 'error' }

function SubmittedChangelistRow({
  entry,
  target,
  worktreeId
}: {
  entry: PerforceHistoryEntry
  target: PerforceTarget
  worktreeId: string
}) {
  const [expanded, setExpanded] = useState(false)
  const [files, setFiles] = useState<FilesState>({ kind: 'idle' })
  const openDiff = useAppStore((s) => s.openDiff)

  useEffect(() => {
    if (!expanded || files.kind !== 'idle') {
      return
    }
    setFiles({ kind: 'loading' })
    void perforceClient
      .describeChange({ ...target, changelist: entry.change })
      .then((f) => setFiles({ kind: 'loaded', files: f }))
      .catch(() => setFiles({ kind: 'error' }))
  }, [expanded, files.kind, target, entry.change])

  const handleFileOpen = (file: PerforceSubmittedFile): void => {
    const relativePath = toSubmittedDiffPath(file.depotPath, entry.change, file.action)
    const { name } = depotBasename(file.depotPath)
    openDiff(
      worktreeId,
      joinPath(target.worktreePath, relativePath),
      relativePath,
      detectLanguage(name),
      true
    )
  }

  const firstLine = entry.description.split('\n')[0] ?? ''
  const tooltip = [
    `@${entry.change}`,
    entry.user,
    new Date(entry.time * 1000).toLocaleString(),
    entry.description
  ]
    .filter(Boolean)
    .join('\n')

  return (
    <div>
      <button
        type="button"
        className="group flex w-full min-w-0 items-start gap-1.5 px-2 py-1 text-left hover:bg-accent"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        title={tooltip}
      >
        {expanded ? (
          <ChevronDown className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="shrink-0 text-[11px] font-semibold text-muted-foreground">
              @{entry.change}
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px]">{firstLine}</span>
          </div>
          <div className="text-[11px] text-muted-foreground">
            {entry.user} · {relativeTime(entry.time)}
          </div>
        </div>
      </button>

      {expanded ? (
        <div className="pb-1">
          {files.kind === 'loading' ? (
            <div className="py-1 pl-7 text-[11px] text-muted-foreground">
              {translate('perforce.ui.loadingHistory', 'Loading…')}
            </div>
          ) : files.kind === 'error' ? (
            <div className="py-1 pl-7 text-[11px] text-destructive">
              {translate('perforce.ui.historyFilesLoadFailed', 'Failed to load files')}
            </div>
          ) : files.kind === 'loaded' && files.files.length === 0 ? null : files.kind ===
            'loaded' ? (
            files.files.map((file) => (
              <SubmittedFileRow
                key={file.depotPath}
                file={file}
                onOpen={() => handleFileOpen(file)}
              />
            ))
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

// ─── public docked section component ─────────────────────────────────────────

const HISTORY_PAGE_SIZE = 30
const HISTORY_MAX_BODY_HEIGHT = 240
const LOAD_MORE_THRESHOLD_PX = 32

export function PerforceHistorySection({
  target,
  worktreeId
}: {
  target: PerforceTarget
  worktreeId: string
}) {
  const [sectionOpen, setSectionOpen] = useState(false)
  const [history, setHistory] = useState<PerforceHistoryEntry[] | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [moreError, setMoreError] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const listLimitRef = useRef(HISTORY_PAGE_SIZE)
  const bodyRef = useRef<HTMLDivElement | null>(null)

  const applyHistory = useCallback((entries: PerforceHistoryEntry[], limit: number): void => {
    setHistory(entries.slice(0, limit))
    setHasMore(entries.length > limit)
    setMoreError(false)
    setError(null)
  }, [])

  // Why: the list is hidden until opened, so fetch on first expand only.
  useEffect(() => {
    if (!sectionOpen || history !== null || loading) {
      return
    }
    const limit = HISTORY_PAGE_SIZE
    listLimitRef.current = limit
    setLoading(true)
    void perforceClient
      .history({ ...target, limit: limit + 1 })
      .then((entries) => applyHistory(entries, limit))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [sectionOpen, history, loading, target, applyHistory])

  // Why: p4 has no cursor; each page refetches one list up to a larger limit.
  const loadMore = useCallback(() => {
    if (history === null || loading || (!hasMore && !moreError)) {
      return
    }
    const previousLimit = listLimitRef.current
    const limit = previousLimit + HISTORY_PAGE_SIZE
    listLimitRef.current = limit
    setLoading(true)
    void perforceClient
      .history({ ...target, limit: limit + 1 })
      .then((entries) => applyHistory(entries, limit))
      .catch(() => {
        listLimitRef.current = previousLimit
        setMoreError(true)
      })
      .finally(() => setLoading(false))
  }, [history, hasMore, moreError, loading, target, applyHistory])

  const handleBodyScroll = useCallback(() => {
    const element = bodyRef.current
    if (!element) {
      return
    }
    if (element.scrollTop + element.clientHeight < element.scrollHeight - LOAD_MORE_THRESHOLD_PX) {
      return
    }
    loadMore()
  }, [loadMore])

  return (
    <div>
      <div className="h-7 pl-1 pr-3">
        <button
          type="button"
          className="flex h-full w-full items-center gap-1 rounded-md px-0.5 text-left text-[11px] font-semibold uppercase tracking-wider text-foreground/70"
          onClick={() => setSectionOpen((v) => !v)}
          aria-expanded={sectionOpen}
        >
          <ChevronDown
            className={cn('size-3 shrink-0 transition-transform', !sectionOpen && '-rotate-90')}
          />
          <span>{translate('perforce.ui.submittedHistory', 'Submitted history')}</span>
          {history !== null && (
            <span className="text-[10px] font-medium tabular-nums">{history.length}</span>
          )}
          {hasMore && <span className="text-[10px] font-medium">+</span>}
        </button>
      </div>

      {sectionOpen ? (
        <div
          ref={bodyRef}
          onScroll={handleBodyScroll}
          className="overflow-y-auto pb-2 scrollbar-sleek"
          style={{ maxHeight: `min(${HISTORY_MAX_BODY_HEIGHT}px, 33vh)` }}
        >
          {loading && history === null ? (
            <div className="px-4 py-2 text-[11px] text-muted-foreground">
              {translate('perforce.ui.loadingHistory', 'Loading…')}
            </div>
          ) : error ? (
            <div className="px-4 py-2 text-[11px] text-destructive">
              {translate('perforce.ui.historyLoadFailed', 'Failed to load history')}
            </div>
          ) : history !== null && history.length === 0 ? (
            <div className="px-4 py-2 text-[11px] text-muted-foreground">
              {translate('perforce.ui.noHistory', 'No submitted changelists')}
            </div>
          ) : history !== null ? (
            <>
              {history.map((entry) => (
                <SubmittedChangelistRow
                  key={entry.change}
                  entry={entry}
                  target={target}
                  worktreeId={worktreeId}
                />
              ))}
              {loading ? (
                <div className="px-4 py-1 text-[11px] text-muted-foreground">
                  {translate('perforce.ui.loadingHistory', 'Loading…')}
                </div>
              ) : moreError ? (
                <button
                  type="button"
                  className="px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                  onClick={loadMore}
                >
                  {translate(
                    'perforce.ui.loadMoreHistoryRetry',
                    'Failed to load more. Click to retry'
                  )}
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
