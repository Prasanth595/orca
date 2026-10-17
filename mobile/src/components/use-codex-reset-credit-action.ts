import { useCallback, useMemo, useRef, useState } from 'react'
import * as ExpoCrypto from 'expo-crypto'
import type { CodexResetCreditExpectedScope } from '../../../src/shared/codex-reset-credit-scope'
import type { RpcClient } from '../transport/rpc-client'
import type { AccountsSnapshot } from './account-usage-state'
import {
  getCodexResetCreditOutcomeCopy,
  getCodexResetCreditScope,
  requestCodexResetCredit
} from './codex-reset-credit'
import { useCodexResetCreditCapability } from './codex-reset-credit-capability'

type CodexResetDialog = { title: string; message: string }

/**
 * A v4 UUID from the platform's random bytes. Not `randomUUID`: on the page that is the browser's,
 * which needs a secure context, and the iOS shell serves the page from a custom scheme.
 */
function createCodexResetIdempotencyKey(): string {
  const bytes = ExpoCrypto.getRandomBytes(16)
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function describeScope(snapshot: AccountsSnapshot, scope: CodexResetCreditExpectedScope): string {
  const account = snapshot.codex.accounts.find((candidate) => candidate.id === scope.accountId)
  const identity = account?.email ?? 'the selected managed account'
  if (scope.target.runtime === 'host') {
    return `${identity} on the host`
  }
  return `${identity} on WSL ${scope.target.wslDistro}`
}

export function useCodexResetCreditAction({
  client,
  connected,
  hostId,
  snapshot,
  accountMutationBusy,
  onSnapshot,
  onNotice
}: {
  client: RpcClient | null
  connected: boolean
  hostId: string | undefined
  snapshot: AccountsSnapshot | null
  accountMutationBusy: boolean
  onSnapshot: (snapshot: AccountsSnapshot) => void
  onNotice: (notice: CodexResetDialog) => void
}): {
  supported: boolean
  resetting: boolean
  resetScope: CodexResetCreditExpectedScope | null
  scopeLabel: string | null
  confirmReset: () => void
  /** The pending confirmation prompt, or null when none is open. */
  confirmation: CodexResetDialog | null
  acceptReset: () => void
  cancelReset: () => void
} {
  const supported = useCodexResetCreditCapability(client, connected)
  const [resetting, setResetting] = useState(false)
  const [confirming, setConfirming] = useState<{
    scope: CodexResetCreditExpectedScope
    label: string
  } | null>(null)
  const inFlightRef = useRef(false)
  const resetScope = useMemo(
    () => (snapshot ? getCodexResetCreditScope(snapshot) : null),
    [snapshot]
  )
  const scopeLabel = useMemo(
    () => (snapshot && resetScope ? describeScope(snapshot, resetScope) : null),
    [resetScope, snapshot]
  )

  const consume = useCallback(
    async (expectedScope: CodexResetCreditExpectedScope) => {
      if (!client || !hostId || inFlightRef.current) {
        return
      }
      inFlightRef.current = true
      setResetting(true)
      try {
        const result = await requestCodexResetCredit(client, {
          hostId,
          expectedScope,
          createIdempotencyKey: createCodexResetIdempotencyKey
        })
        onSnapshot(result.snapshot)
        if ('status' in result) {
          const cleanupWarning = result.attemptJournalRetained
            ? '\n\nThis phone could not clear the discarded retry record. Retrying it is safe, but the record must be cleared before a new reset can be confirmed for this account.'
            : ''
          onNotice({
            title: 'Reset details changed',
            message: `The account or reset offer changed before the host contacted Codex. Review the updated details, then confirm again.${cleanupWarning}`
          })
          return
        }
        const copy = getCodexResetCreditOutcomeCopy(result.outcome)
        const cleanupWarning = result.attemptJournalRetained
          ? '\n\nThe host confirmed this attempt, but this phone could not clear its retry record. A later retry will reuse the same safe operation ID.'
          : ''
        onNotice({ title: copy.title, message: `${copy.message}${cleanupWarning}` })
      } catch (error) {
        onNotice({
          title: 'Could not reset rate limits',
          message: error instanceof Error ? error.message : String(error)
        })
      } finally {
        inFlightRef.current = false
        setResetting(false)
      }
    },
    [client, hostId, onNotice, onSnapshot]
  )

  const confirmReset = useCallback(() => {
    if (!supported || !connected || accountMutationBusy || resetting || !resetScope || !snapshot) {
      return
    }
    // The scope is pinned when the prompt opens, so a snapshot arriving under it changes nothing.
    setConfirming({ scope: resetScope, label: describeScope(snapshot, resetScope) })
  }, [accountMutationBusy, connected, resetScope, resetting, snapshot, supported])

  const acceptReset = useCallback(() => {
    if (confirming) {
      setConfirming(null)
      void consume(confirming.scope)
    }
  }, [confirming, consume])
  const cancelReset = useCallback(() => setConfirming(null), [])
  const confirmation = confirming
    ? {
        title: 'Use a rate-limit reset?',
        message: `This spends one earned reset for ${confirming.label} and immediately resets eligible rate-limit windows.`
      }
    : null

  return {
    supported,
    resetting,
    resetScope,
    scopeLabel,
    confirmReset,
    confirmation,
    acceptReset,
    cancelReset
  }
}
