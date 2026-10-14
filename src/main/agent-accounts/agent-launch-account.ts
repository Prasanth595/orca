import type { AgentRunAccountProvider } from '../../shared/agent-run-account'
import {
  normalizeAgentProviderSession,
  type AgentProviderSessionMetadata
} from '../../shared/agent-session-resume'
import type { GlobalSettings } from '../../shared/global-settings-types'
import type { TuiAgent } from '../../shared/tui-agent'
import type { AgentSessionPreSpawnError } from '../native-chat/agent-session-wire/structured-agent-session-adapter'
import { keptAccountRefusals } from './kept-account-refusals'
import type { KeptAgentConversations } from './kept-agent-conversations'

/** Which account a spawn runs on. Later steps (placement, explicit requests) add kinds here. */
export type AgentLaunchAccount =
  | { kind: 'follow' }
  | { kind: 'bound'; provider: AgentRunAccountProvider; accountId: string | null; mode: 'kept' }
  | { kind: 'refuse'; error: AgentSessionPreSpawnError }

/**
 * One resolver for both spawn paths, so they cannot drift. Pure and synchronous: a spawn must
 * not gain an await here. With no keep for the conversation the spawn follows the selection
 * exactly as before; a keep that cannot be honoured refuses rather than falling back.
 */
export function resolveAgentLaunchAccount(input: {
  connectionId: string | null | undefined
  launchAgent: TuiAgent | undefined
  resumeProviderSession: AgentProviderSessionMetadata | undefined
  /** The pane's selection lane ('host' | 'wsl:<distro>'). */
  lane: string
  kept: Pick<KeptAgentConversations, 'get'> | undefined
  settings: Pick<GlobalSettings, 'claudeManagedAccounts' | 'codexManagedAccounts'> | undefined
}): AgentLaunchAccount {
  const provider = input.launchAgent
  const session = normalizeAgentProviderSession(input.resumeProviderSession)
  if (input.connectionId || (provider !== 'claude' && provider !== 'codex') || !session) {
    return { kind: 'follow' }
  }
  const entry = input.kept?.get(provider, session.id)
  if (entry === 'unavailable') {
    return { kind: 'refuse', error: keptAccountRefusals.indexUnavailable() }
  }
  if (!entry) {
    return { kind: 'follow' }
  }
  if (entry.lane !== input.lane) {
    return { kind: 'refuse', error: keptAccountRefusals.laneMismatch() }
  }
  const accounts =
    provider === 'claude'
      ? input.settings?.claudeManagedAccounts
      : input.settings?.codexManagedAccounts
  // Why refuse: removal releases its keeps, so a dangling one means that release failed.
  if (entry.accountId !== null && !accounts?.some((account) => account.id === entry.accountId)) {
    return { kind: 'refuse', error: keptAccountRefusals.accountRemoved() }
  }
  return { kind: 'bound', provider, accountId: entry.accountId, mode: 'kept' }
}
