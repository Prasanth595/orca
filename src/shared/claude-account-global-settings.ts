import type {
  ClaudeManagedAccount,
  ClaudeManagedAccountRuntimeSelection
} from './managed-account-types'

/** The Claude account settings, kept apart so the global settings type stays under its size cap. */
export type ClaudeAccountGlobalSettings = {
  /** Why: persist only per-account auth (not a CLAUDE_CONFIG_DIR swap) so switching accounts doesn't fork Claude's shared chat/session context. */
  claudeManagedAccounts: ClaudeManagedAccount[]
  activeClaudeManagedAccountId: string | null
  activeClaudeManagedAccountIdsByRuntime?: ClaudeManagedAccountRuntimeSelection
  /** After an account switch, reopen idle Claude sessions on the selected account. Off by default. */
  claudeMoveIdleSessions?: boolean
}
