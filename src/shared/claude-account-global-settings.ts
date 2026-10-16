import type {
  ClaudeManagedAccount,
  ClaudeManagedAccountRuntimeSelection
} from './managed-account-types'

/** The Claude account settings, kept apart so the global settings type stays under its size cap. */
export type ClaudeAccountGlobalSettings = {
  claudeManagedAccounts: ClaudeManagedAccount[]
  activeClaudeManagedAccountId: string | null
  activeClaudeManagedAccountIdsByRuntime?: ClaudeManagedAccountRuntimeSelection
  /** After an account switch, reopen idle Claude sessions on the selected account. Off by default. */
  claudeMoveIdleSessions?: boolean
}
