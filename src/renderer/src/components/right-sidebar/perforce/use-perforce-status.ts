import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { publishPerforceOpenedFiles } from './perforce-opened-files'
import type {
  PerforceOperationResult,
  PerforceStatusResult
} from '../../../../../shared/perforce/perforce-types'
import { translate } from '@/i18n/i18n'
import { perforceClient } from '@/runtime/runtime-perforce-client'

export type PerforceTarget = { worktreePath: string; connectionId?: string; worktreeId?: string }

export function usePerforceStatus(target: PerforceTarget, refreshIntervalSeconds: number) {
  const { worktreePath, connectionId, worktreeId } = target
  const [status, setStatus] = useState<PerforceStatusResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const requestId = useRef(0)

  const refresh = useCallback(async (): Promise<void> => {
    const id = ++requestId.current
    try {
      const next = await perforceClient.status({ worktreePath, connectionId, worktreeId })
      if (id === requestId.current) {
        setStatus(next)
        publishPerforceOpenedFiles(worktreePath, connectionId, next.entries)
        setError(null)
      }
    } catch (caught) {
      if (id === requestId.current) {
        setError(caught instanceof Error ? caught.message : String(caught))
      }
    }
  }, [worktreePath, connectionId, worktreeId])

  useEffect(() => {
    void refresh()
    if (refreshIntervalSeconds <= 0) {
      return
    }
    const timer = window.setInterval(() => void refresh(), refreshIntervalSeconds * 1000)
    return () => window.clearInterval(timer)
  }, [refresh, refreshIntervalSeconds])

  /** Runs a p4 mutation, surfaces failures as a toast, and refreshes afterwards. */
  const run = useCallback(
    async (operation: () => Promise<PerforceOperationResult>, successMessage?: string) => {
      setBusy(true)
      try {
        const result = await operation()
        if (!result.success) {
          toast.error(
            result.error ??
              translate('perforce.ui.perforceCommandFailed', 'Perforce command failed')
          )
        } else if (successMessage) {
          toast.success(successMessage, result.output ? { description: result.output } : undefined)
        }
        return result.success
      } catch (caught) {
        toast.error(caught instanceof Error ? caught.message : String(caught))
        return false
      } finally {
        setBusy(false)
        void refresh()
      }
    },
    [refresh]
  )

  return { status, error, busy, refresh, run }
}
