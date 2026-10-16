import { useCallback, useEffect, useState } from 'react'
import { perforceClient } from '@/runtime/runtime-perforce-client'

// Why: detection shells out to `p4 info` (over SSH for remote folders), so remember answers per workspace.
const detectionByKey = new Map<string, Promise<boolean>>()
const knownWorkspaces = new Set<string>()

/** Synchronous answer for key handlers: true only after a positive detection this session. */
export function isKnownPerforceWorkspace(
  worktreePath: string,
  connectionId?: string | null
): boolean {
  return knownWorkspaces.has(`${connectionId ?? ''}|${worktreePath}`)
}

function detectPerforceWorkspace(
  worktreePath: string,
  connectionId?: string,
  worktreeId?: string | null
): Promise<boolean> {
  const key = `${connectionId ?? ''}|${worktreePath}`
  let pending = detectionByKey.get(key)
  if (!pending) {
    pending = Promise.resolve()
      .then(() => perforceClient.detect({ worktreePath, connectionId, worktreeId }))
      .then((result) => {
        // Only positive answers are remembered so a later p4 setup/login is detected on retry.
        if (result.isWorkspace) {
          knownWorkspaces.add(key)
        } else {
          detectionByKey.delete(key)
          knownWorkspaces.delete(key)
        }
        return result.isWorkspace
      })
      .catch(() => {
        detectionByKey.delete(key)
        return false
      })
    detectionByKey.set(key, pending)
  }
  return pending
}

/** True when a folder workspace (local or over SSH) sits inside a Perforce client workspace. */
export function usePerforceWorkspace(
  worktreePath: string | null,
  connectionId: string | null | undefined,
  eligible: boolean,
  worktreeId?: string | null
): { isPerforce: boolean; redetect: () => void } {
  const [detected, setDetected] = useState<{ key: string; value: boolean } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const key = `${connectionId ?? ''}|${worktreePath ?? ''}`

  const redetect = useCallback(() => {
    detectionByKey.delete(key)
    knownWorkspaces.delete(key)
    setAttempt((n) => n + 1)
  }, [key])

  useEffect(() => {
    if (!worktreePath || !eligible) {
      return
    }
    let cancelled = false
    const run = (): void => {
      void detectPerforceWorkspace(worktreePath, connectionId ?? undefined, worktreeId).then(
        (value) => {
          if (!cancelled) {
            setDetected({ key, value })
          }
        }
      )
    }
    run()
    // Why: a workspace set up while Orca is open should appear when the user returns to it.
    const onFocus = (): void => {
      if (!detectionByKey.has(key)) {
        run()
      }
    }
    window.addEventListener('focus', onFocus)
    return () => {
      cancelled = true
      window.removeEventListener('focus', onFocus)
    }
  }, [worktreePath, connectionId, worktreeId, eligible, key, attempt])

  return {
    isPerforce: Boolean(eligible && worktreePath && detected?.key === key && detected.value),
    redetect
  }
}
