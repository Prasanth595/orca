import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type {
  ClaudeRateLimitAccountsState,
  CodexRateLimitAccountsState
} from '../../../../shared/managed-account-types'
import { translate } from '@/i18n/i18n'
import type { RuntimeClientTarget } from '@/runtime/runtime-client-target'
import {
  watchProviderAccounts,
  type ProviderAccountsSnapshot
} from '@/runtime/runtime-provider-accounts-client'

export function useAccountsPaneUsage({
  scopeEnvironmentId,
  usageRefreshRevision,
  setCodexAccounts,
  setCodexAccountsLoaded,
  setClaudeAccounts
}: {
  scopeEnvironmentId: string | null
  usageRefreshRevision: number
  setCodexAccounts: (state: CodexRateLimitAccountsState) => void
  setCodexAccountsLoaded: (loaded: boolean) => void
  setClaudeAccounts: (state: ClaudeRateLimitAccountsState) => void
}): ProviderAccountsSnapshot | null {
  const [reading, setReading] = useState<{
    environmentId: string | null
    snapshot: ProviderAccountsSnapshot
  } | null>(null)
  useEffect(() => {
    const owner: RuntimeClientTarget = scopeEnvironmentId
      ? { kind: 'environment', environmentId: scopeEnvironmentId }
      : { kind: 'local' }
    const watcher = watchProviderAccounts(
      owner,
      {
        onSnapshot: (snapshot) => {
          setReading({ environmentId: scopeEnvironmentId, snapshot })
          // A failed provider's empty roster is not authoritative.
          if (!snapshot.failedProviders?.includes('codex')) {
            setCodexAccounts(snapshot.codex)
            setCodexAccountsLoaded(true)
          }
          if (!snapshot.failedProviders?.includes('claude')) {
            setClaudeAccounts(snapshot.claude)
          }
        },
        onError: (error) => {
          setReading(null)
          toast.error(
            translate(
              'auto.components.settings.AccountsPane.loadAccountsFailed',
              'Could not load provider accounts.'
            ),
            {
              description: error instanceof Error ? error.message : String(error)
            }
          )
        }
      },
      { liveUsage: true }
    )
    return () => watcher.close()
  }, [
    scopeEnvironmentId,
    usageRefreshRevision,
    setCodexAccounts,
    setCodexAccountsLoaded,
    setClaudeAccounts
  ])
  return reading?.environmentId === scopeEnvironmentId ? reading.snapshot : null
}
