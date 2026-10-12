import type { StructuredAgentId } from '../../shared/agent-session-provider-handle'
import type { GlobalSettings } from '../../shared/global-settings-types'
import type { LegacyAgentSessionAccountHome } from '../../shared/agent-session-account-home'
import { isNativeLocalLocation } from '../../shared/execution-host'
import type { AgentSessionExecutionLocation } from '../../shared/agent-session-record'
import { getClaudeProfileRouter } from '../claude-accounts/claude-profile-installed-router'

export type ManagedStructuredCreateInput = {
  envelope: { sessionId: string; clientOperationId: string }
  worktree: string
  agent: StructuredAgentId
  callerKey?: string
  managedAccountId?: string
  resumeFrom?: { providerSessionId: string }
}

/** A client names a saved identity; only its execution host resolves credential directories. */
export async function resolveManagedStructuredAccountHome(input: {
  settings: Pick<GlobalSettings, 'claudeManagedAccounts' | 'codexManagedAccounts'>
  agent: string
  accountId: string
  location: AgentSessionExecutionLocation
  launchEnv: NodeJS.ProcessEnv
  prepareCodexHome:
    | ((args: {
        launchEnv: NodeJS.ProcessEnv
        managedAccountId?: string
      }) => string | null | Promise<string | null>)
    | null
}): Promise<LegacyAgentSessionAccountHome> {
  if (!isNativeLocalLocation(input.location)) {
    throw new Error('Select an account on the host executing this session.')
  }
  if (input.agent === 'claude') {
    const account = input.settings.claudeManagedAccounts.find(
      (entry) => entry.id === input.accountId
    )
    const router = getClaudeProfileRouter()
    if (!account || account.managedAuthRuntime === 'wsl' || !router?.accountLogin(account.id)) {
      throw new Error('Sign in to this Claude account on the execution host first.')
    }
    return { variable: 'CLAUDE_CONFIG_DIR', path: await router.prepareAccount(account.id) }
  }
  if (input.agent === 'codex') {
    const account = input.settings.codexManagedAccounts.find(
      (entry) => entry.id === input.accountId
    )
    if (!account || account.managedHomeRuntime === 'wsl' || !input.prepareCodexHome) {
      throw new Error('The Codex account is not available on this execution host.')
    }
    const path = await input.prepareCodexHome({
      launchEnv: input.launchEnv,
      managedAccountId: account.id
    })
    if (!path) {
      throw new Error('The requested Codex account could not be prepared.')
    }
    return { variable: 'CODEX_HOME', path }
  }
  throw new Error('Managed account selection is supported for Claude and Codex.')
}
