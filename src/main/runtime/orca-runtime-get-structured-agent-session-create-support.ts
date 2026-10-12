// @ts-nocheck -- mechanically split from OrcaRuntimeService; behavior is covered by AST equivalence and characterization tests.
import { applyStructuredCodexWorkspaceTrust } from '../agent-workspace-trust-spawn'
import {
  resolveManagedStructuredAccountHome,
  type ManagedStructuredCreateInput
} from './managed-structured-account-home'
import { agentSessionRefusalError } from '../../shared/agent-session-wire-refusals'
import { OrcaRuntimeWithGetWorktreePs } from './orca-runtime-get-worktree-ps'
import { getStructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-registry'
import {
  resolveCommittedStructuredAgentSessionAdoptionIntent,
  resolveStructuredAgentSessionAdoptionForCreate
} from './structured-agent-session-create-adoption'
import { isNativeLocalLocation, LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'
import { getLocalProjectWorktreeGitOptions } from '../project-runtime-git-options'
import type { AgentSessionAttachParams } from '../native-chat/agent-session-wire/structured-agent-session-attach'
import { resolveTuiAgentLaunchEnv } from '../../shared/tui-agent-launch-defaults'
import { resolveHostStructuredAgentCreateSupport } from './structured-agent-launch-support'
import { structuredAgentRuntimeRegistration } from './structured-agent-runtime-registrations'
import { resolveStructuredLaunchSeedOptions } from '../../shared/native-chat-session-option-defaults'
import { hasPersistedStructuredAgentSessionStore as hasPersistedStructuredAgentSessionStoreOnDisk } from './structured-agent-session-runtime'
import { ensureStructuredAgentSessionHostUnlessRefused } from './structured-agent-session-host-refusal'
import { getProfileUserDataPath } from '../orca-profiles/profile-storage-paths'
import { parseWslUncPath } from '../../shared/wsl-paths'
import {
  isFloatingWorkspaceId,
  isFloatingWorkspaceSelector
} from '../../shared/floating-workspace-worktree'
import { parseWorkspaceKey } from '../../shared/workspace-scope'
import {
  isLegacyAgentSessionAccountHome,
  type AgentSessionAccountHome
} from '../../shared/agent-session-account-home'
import {
  isAgentSessionHandleProvider,
  type StructuredAgentId
} from '../../shared/agent-session-provider-handle'
import { agentSessionWireProviderHandle } from '../../shared/agent-session-provider-handle-encoding'

export class OrcaRuntimeWithGetStructuredAgentSessionCreateSupport extends OrcaRuntimeWithGetWorktreePs {
  async getStructuredAgentSessionCreateSupport(
    worktreeSelector: string,
    agent: StructuredAgentId
  ): Promise<{ supported: boolean; reason?: 'agent' | 'remote' | 'wsl' }> {
    return resolveHostStructuredAgentCreateSupport({
      agent,
      worktreeSelector,
      location: await this.resolveStructuredAgentSessionLocation(worktreeSelector),
      runtime: this
    })
  }

  /** Resolve the registered agent's account home on this host. */
  protected structuredAgentAccountHomeResolver(
    agent: StructuredAgentId,
    worktree: string,
    purpose: 'launch' | 'read',
    hostLaunchDirectory?: string
  ) {
    const registration = structuredAgentRuntimeRegistration(agent)
    if (!registration) {
      return null
    }
    const services = {
      getClaudeConfigDirectory: (target) => this.accounts.getClaudeConfigDirectory(target),
      prepareCodexLaunchHome: this.prepareCodexStructuredLaunchFn,
      readCodexLaunchHome: this.resolveCodexStructuredLaunchHomeFn,
      workspaceTrustSettings: () => this.requireStore().getSettings()
    }
    return async ({ launchEnv, location }) =>
      registration.resolveAccountHome(
        {
          launchEnv,
          location: location ?? null,
          purpose,
          workspacePath:
            purpose === 'launch'
              ? async () =>
                  hostLaunchDirectory ??
                  (await this.resolveRuntimeFileTarget(worktree)).worktree.path
              : null
        },
        services
      )
  }

  /** Read the registered agent definition without installing a host. */
  protected requireRegisteredStructuredAgent(agent: StructuredAgentId) {
    const definition = structuredAgentRuntimeRegistration(agent)?.definition
    if (!definition) {
      throw agentSessionRefusalError('structured_agent_session_unsupported', {
        reason: 'hostUnsupported'
      })
    }
    return definition
  }

  /** The saved selection a new chat starts with. */
  structuredAgentSessionLaunchSeedOptions(
    agent: StructuredAgentId
  ): Record<string, string> | undefined {
    return resolveStructuredLaunchSeedOptions(
      this.requireStore().getSettings().nativeChatSessionOptions,
      agent
    )
  }

  protected async resolveStructuredAgentSessionLocation(worktreeSelector: string) {
    const target = await this.resolveRuntimeFileTarget(worktreeSelector)
    const repo = this.store?.getRepo(target.worktree.repoId)
    const folderScope = parseWorkspaceKey(target.worktree.id)
    const folderWorkspace =
      folderScope?.type === 'folder' || isFloatingWorkspaceId(target.worktree.id)
    const isLocalHost = target.executionHostId === LOCAL_EXECUTION_HOST_ID
    const configuredWslDistro =
      repo && isLocalHost
        ? (getLocalProjectWorktreeGitOptions(this.requireStore(), repo).wslDistro ?? null)
        : null
    const wslDistro =
      configuredWslDistro ??
      (folderWorkspace && isLocalHost
        ? (parseWslUncPath(target.worktree.path)?.distro ?? null)
        : null)
    return {
      executionHostId: target.executionHostId,
      wslDistro,
      workspaceId: target.worktree.id,
      workspaceKind: folderWorkspace ? ('folder' as const) : ('git-worktree' as const)
    }
  }

  /** Resolve a local workspace path, or null for remote/WSL locations. */
  async resolveStructuredAgentSessionLocalWorkspacePath(worktreeSelector: string) {
    const location = await this.resolveStructuredAgentSessionLocation(worktreeSelector)
    if (!isNativeLocalLocation(location)) {
      return null
    }
    return (await this.resolveRuntimeFileTarget(worktreeSelector)).worktree.path
  }

  async resolveStructuredAgentSessionCreateIntent(
    input: ManagedStructuredCreateInput
  ): Promise<AgentSessionAttachParams & { hostLaunchDirectory?: string }> {
    const hostLaunchDirectory = isFloatingWorkspaceSelector(input.worktree)
      ? (await this.resolveRuntimeFileTarget(input.worktree)).worktree.path
      : undefined
    const resolveAccountHome = this.structuredAgentAccountHomeResolver(
      input.agent,
      input.worktree,
      'launch',
      hostLaunchDirectory
    )
    if (!resolveAccountHome) {
      throw agentSessionRefusalError('structured_agent_session_unsupported', {
        reason: 'hostUnsupported'
      })
    }
    const resolved = await this.resolveStructuredAgentSessionIntent(input, resolveAccountHome)
    return hostLaunchDirectory ? { ...resolved, hostLaunchDirectory } : resolved
  }

  /** Resolve the current account home for model catalog reads. */
  async resolveStructuredAgentAccountHome(
    agent: StructuredAgentId
  ): Promise<AgentSessionAccountHome> {
    const resolveAccountHome = this.structuredAgentAccountHomeResolver(agent, '', 'read')
    if (!resolveAccountHome) {
      throw agentSessionRefusalError('structured_agent_session_unsupported', {
        reason: 'hostUnsupported'
      })
    }
    const launchEnv = resolveTuiAgentLaunchEnv(
      agent,
      this.requireStore().getSettings().agentDefaultEnv
    )
    return resolveAccountHome({ launchEnv, location: null })
  }

  protected async resolveStructuredAgentSessionIntent(
    input: ManagedStructuredCreateInput,
    resolveAccountHome: (context: {
      launchEnv: NodeJS.ProcessEnv
      location: {
        executionHostId: string
        wslDistro: string | null
        workspaceId: string
        workspaceKind: 'folder' | 'git-worktree'
      }
    }) => AgentSessionAccountHome | Promise<AgentSessionAccountHome>
  ): Promise<AgentSessionAttachParams> {
    if (input.managedAccountId && input.resumeFrom) {
      throw new Error('An imported conversation keeps its original account.')
    }
    const support = await this.getStructuredAgentSessionCreateSupport(input.worktree, input.agent)
    if (!support.supported || (input.resumeFrom && !isAgentSessionHandleProvider(input.agent))) {
      throw agentSessionRefusalError('structured_agent_session_unsupported', {
        reason: 'hostUnsupported'
      })
    }
    const settings = this.requireStore().getSettings()
    const launchEnv = resolveTuiAgentLaunchEnv(input.agent, settings.agentDefaultEnv)
    const options = this.structuredAgentSessionLaunchSeedOptions(input.agent)
    const location = await this.resolveStructuredAgentSessionLocation(input.worktree)
    const definition = this.requireRegisteredStructuredAgent(input.agent)
    const host = getStructuredAgentSessionHost()
    const committedReplay = resolveCommittedStructuredAgentSessionAdoptionIntent({
      host,
      ...input,
      location,
      ...(options ? { options } : {})
    })
    if (committedReplay) {
      return committedReplay
    }
    if (input.managedAccountId && input.agent === 'codex') {
      await applyStructuredCodexWorkspaceTrust({
        workspacePath: (await this.resolveRuntimeFileTarget(input.worktree)).worktree.path,
        launchEnv,
        settings
      })
    }
    const selectedAccountHome = input.managedAccountId
      ? await resolveManagedStructuredAccountHome({
          settings,
          agent: input.agent,
          accountId: input.managedAccountId,
          location,
          launchEnv,
          prepareCodexHome: this.prepareCodexStructuredLaunchFn
        })
      : await resolveAccountHome({ launchEnv, location })
    if (input.resumeFrom && !isLegacyAgentSessionAccountHome(selectedAccountHome)) {
      throw agentSessionRefusalError('structured_agent_session_unsupported', {
        reason: 'hostUnsupported'
      })
    }
    const adoption =
      input.resumeFrom && isLegacyAgentSessionAccountHome(selectedAccountHome)
        ? await resolveStructuredAgentSessionAdoptionForCreate({
            host,
            settings,
            agent: input.agent,
            providerSessionId: input.resumeFrom.providerSessionId,
            selfSessionId: input.envelope.sessionId,
            selectedAccountHomePath: selectedAccountHome.path
          })
        : null
    return {
      envelope: {
        sessionId: input.envelope.sessionId,
        clientOperationId: input.envelope.clientOperationId,
        expectedRuntimeFence: null,
        payloadFingerprint: ''
      },
      location,
      provider: input.agent,
      agent: input.agent,
      accountHome:
        adoption && isLegacyAgentSessionAccountHome(selectedAccountHome)
          ? { variable: selectedAccountHome.variable, path: adoption.accountHomePath }
          : selectedAccountHome,
      ...(options ? { options } : {}),
      ...(input.resumeFrom && adoption
        ? {
            adopt: {
              providerHandle: agentSessionWireProviderHandle({
                transport: definition.handleTransport,
                agent: definition.agent,
                nativeId: input.resumeFrom.providerSessionId
              }),
              transcriptPath: adoption.transcriptPath
            }
          }
        : {}),
      runtimeKind: 'native'
    }
  }

  restoreStructuredAgentSessionTabs(): Promise<void> {
    this.structuredAgentSessionTabRestorePromise ??=
      this.restoreStructuredAgentSessionTabsOnce().then(
        () => {
          if (this.structuredAgentSessionInventoryUnverifiable) {
            this.structuredAgentSessionTabRestorePromise = null
          }
        },
        (error) => {
          this.structuredAgentSessionTabRestorePromise = null
          throw error
        }
      )
    return this.structuredAgentSessionTabRestorePromise
  }

  prepareStructuredAgentSessionStartupRestoration(): Promise<void> {
    this.structuredAgentSessionStartupRestorePromise ??=
      this.prepareStructuredAgentSessionStartupRestorationOnce().catch((error) => {
        this.structuredAgentSessionStartupRestorePromise = null
        throw error
      })
    return this.structuredAgentSessionStartupRestorePromise
  }

  protected async prepareStructuredAgentSessionStartupRestorationOnce(): Promise<void> {
    if (!this.hasPersistedStructuredAgentSessionStore()) {
      return
    }
    // Durable agent records must exist before daemon inventory can be reconciled against them.
    // A refused host is no host: startup goes on, and only structured requests are refused.
    await ensureStructuredAgentSessionHostUnlessRefused(() =>
      this.ensureStructuredAgentSessionHost()
    )
    await this.refreshMobileSessionPtyRecords()
    await getStructuredAgentSessionHost()?.reconcileRestartLeases()
  }

  protected hasPersistedStructuredAgentSessionStore(): boolean {
    return hasPersistedStructuredAgentSessionStoreOnDisk(getProfileUserDataPath())
  }
}
