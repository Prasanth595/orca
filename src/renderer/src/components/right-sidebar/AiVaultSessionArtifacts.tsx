import type React from 'react'
import { useCallback, useEffect, useState } from 'react'
import { FolderOpen, FileText, Image, File, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { AiVaultSession, AiVaultSessionArtifact } from '../../../../shared/ai-vault-types'
import { openAiVaultSessionArtifactInOrca } from './ai-vault-session-artifact-open'

/** Returns an icon component matching the artifact file extension. */
function artifactIcon(name: string): React.JSX.Element {
  const lower = name.toLowerCase()
  if (lower.endsWith('.md') || lower.endsWith('.txt') || lower.endsWith('.jsonl')) {
    return <FileText className="size-3.5 shrink-0" />
  }
  if (
    lower.endsWith('.png') ||
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg') ||
    lower.endsWith('.webp') ||
    lower.endsWith('.gif') ||
    lower.endsWith('.svg')
  ) {
    return <Image className="size-3.5 shrink-0" />
  }
  return <File className="size-3.5 shrink-0" />
}

/** Formats a byte count as a human-readable string (B, KB, or MB). */
function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  const kb = bytes / 1024
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`
  }
  return `${(kb / 1024).toFixed(1)} MB`
}

/**
 * Renders an Artifacts toggle button (for the action row) and an expandable
 * artifact list (rendered as a sibling via React Fragment). The button sits
 * inline with other action buttons; the list appears below the action row.
 */
export function SessionArtifactsSection({
  session
}: {
  session: AiVaultSession
}): React.JSX.Element | null {
  const [artifacts, setArtifacts] = useState<AiVaultSessionArtifact[]>([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!expanded) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(false)
    window.api.aiVault
      .listSessionArtifacts({
        agent: session.agent,
        filePath: session.filePath,
        executionHostId: session.executionHostId
      })
      .then((result) => {
        if (!cancelled) {
          setArtifacts(result.artifacts)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setArtifacts([])
          setError(true)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [expanded, session.agent, session.filePath, session.executionHostId])

  /** Toggles the artifact list open or closed. */
  const toggleExpanded = useCallback(() => {
    setExpanded((prev) => !prev)
  }, [])

  if (session.agent !== 'antigravity') {
    return null
  }

  return (
    <>
      <Button
        aria-expanded={expanded}
        type="button"
        variant="ghost"
        size="xs"
        draggable={false}
        onClick={(event) => {
          event.stopPropagation()
          toggleExpanded()
        }}
        className="h-7 shrink-0 px-2.5 text-[11px] text-muted-foreground"
      >
        <FolderOpen className="size-3.5" />
        {translate(
          'auto.components.right.sidebar.AiVaultSessionArtifacts.viewArtifacts',
          'Artifacts'
        )}
        {loading ? <Loader2 className="size-3 animate-spin" /> : null}
        {!loading && artifacts.length > 0 ? (
          <span className="text-[10px] text-muted-foreground/70">({artifacts.length})</span>
        ) : null}
      </Button>
      {expanded ? (
        <div className="w-full space-y-0.5 pt-1.5">
          {loading ? (
            <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-muted-foreground">
              <Loader2 className="size-3 animate-spin" />
              {translate(
                'auto.components.right.sidebar.AiVaultSessionArtifacts.loading',
                'Loading artifacts...'
              )}
            </div>
          ) : error ? (
            <div className="px-2 py-1 text-[11px] text-destructive">
              {translate(
                'auto.components.right.sidebar.AiVaultSessionArtifacts.loadError',
                'Failed to load artifacts'
              )}
            </div>
          ) : artifacts.length === 0 ? (
            <div className="px-2 py-1 text-[11px] text-muted-foreground">
              {translate(
                'auto.components.right.sidebar.AiVaultSessionArtifacts.noArtifacts',
                'No artifacts found'
              )}
            </div>
          ) : (
            artifacts.map((artifact) => (
              <button
                key={artifact.filePath}
                type="button"
                className={cn(
                  'flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[11px]',
                  'text-foreground/80 hover:bg-accent hover:text-accent-foreground',
                  'transition-colors'
                )}
                onClick={(event) => {
                  event.stopPropagation()
                  void openAiVaultSessionArtifactInOrca(artifact)
                }}
                title={artifact.filePath}
              >
                {artifactIcon(artifact.name)}
                <span className="min-w-0 flex-1 truncate">{artifact.name}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground/70">
                  {formatBytes(artifact.sizeBytes)}
                </span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </>
  )
}
