import { OrcaRuntimeWithCreateMobileSessionTerminal } from './mobile-terminal-create'
import type { MobileTerminalCreateOptions } from './mobile-terminal-renderer-create'
import type { OwnedMobileTerminalCreateOptions } from './mobile-terminal-owned-create'
import type { TerminalWorkspaceLaunchScope } from '../../runtime-legacy-worker-terminal-recovery-types'
import type { RuntimeMobileSessionCreateTerminalResult } from '../../../../shared/runtime-types'
import { prepareStructuredChatCliFork, isStructuredChatCliForkSourceCurrent } from '../../../ai-vault/structured-chat-cli-fork'
import { buildMobileTerminalChatFork } from './mobile-terminal-chat-fork'
import { isWslUncPath } from '../../../../shared/wsl-paths'
import { isTuiAgent } from '../../../../shared/tui-agent-config'
import { applyClaudeTerminalImageViewerEnv } from '../../terminal-image-viewer-env'
import { deterministicAgentSessionUuid } from '../../runtime-agent-launch-resolution'
import { rendererPublicationThrottle } from '../../../window/renderer-publication-throttle'

export abstract class OrcaRuntimeWithMobileChatForkCreate extends OrcaRuntimeWithCreateMobileSessionTerminal {
  protected abstract captureReadyGraphEpoch(): number
  protected abstract assertStableReadyGraph(expectedGraphEpoch: number): void
  protected abstract createRuntimeOwnedMobileSessionTerminal(
    worktreeId: string,
    activate: boolean,
    afterTabId?: string,
    opts?: OwnedMobileTerminalCreateOptions
  ): Promise<RuntimeMobileSessionCreateTerminalResult>

  protected async createMobileChatForkTerminal(args: {
    workspace: TerminalWorkspaceLaunchScope
    worktreeId: string
    opts: MobileTerminalCreateOptions
    afterTabId?: string
    afterDesktopTabId?: string
    graphEpoch: number
  }): Promise<RuntimeMobileSessionCreateTerminalResult> {
    const { workspace, worktreeId, opts, afterTabId, afterDesktopTabId, graphEpoch } = args
    const sourceId = opts.sourceChatFork?.sessionId
    const mutationId = opts.clientMutationId
    if (!sourceId || !mutationId || workspace.connectionId || isWslUncPath(workspace.path) || !this.store) {
      throw new Error('chat_fork_runtime_incompatible')
    }
    await this.ensureStructuredAgentSessionHost()
    const prepared = await prepareStructuredChatCliFork(
      { sourceChat: { sessionId: sourceId, workspaceId: worktreeId }, fork: true },
      (prepareArgs) => this.aiVault.prepare(prepareArgs)
    )
    this.assertStableReadyGraph(graphEpoch)
    if (!isStructuredChatCliForkSourceCurrent(sourceId, worktreeId) ||
      !this.mobileSessionTabsByWorktree.get(worktreeId)?.tabs.some((tab) =>
        tab.type === 'agent-session' && tab.sessionId === sourceId
      )) {
      throw new Error('chat_fork_source_unavailable')
    }
    if (afterDesktopTabId && !this.mobileSessionTabsByWorktree.get(worktreeId)?.tabs.some(
      (tab) => tab.id === afterDesktopTabId ||
        (tab.type === 'terminal' && tab.parentTabId === afterDesktopTabId)
    )) {
      throw new Error('chat_fork_anchor_changed')
    }
    if (opts.signal?.aborted) throw new Error('client_disconnected')
    const sourceAgent = prepared.cliForkSource?.agent
    if (!sourceAgent || !isTuiAgent(sourceAgent)) {
      throw new Error('chat_fork_source_unavailable')
    }
    const settings = this.store.getSettings()
    const launchRuntime = this.resolveAgentLaunchRuntime(workspace, sourceAgent)
    const startup = applyClaudeTerminalImageViewerEnv(buildMobileTerminalChatFork({
      prepared, settings, runtime: launchRuntime
    }), opts.terminalImageViewerSupported)
    const clientIdentity = opts.clientNavigationId ?? 'local'
    const seed = `${clientIdentity}\0${worktreeId}\0${mutationId}`
    const win = this.getAvailableAuthoritativeWindow()
    const targetGroupId = opts.targetGroupId ??
      this.getWorkspaceSessionForWorktree(worktreeId)?.activeGroupIdByWorktree?.[worktreeId] ??
      this.mobileSessionTabsByWorktree.get(worktreeId)?.activeGroupId
    const releaseThrottle = win && !win.webContents.isDestroyed?.()
      ? rendererPublicationThrottle.acquire(win.webContents) : () => {}
    try {
      const created = await this.createRuntimeOwnedMobileSessionTerminal(
        worktreeId, opts.activate !== false, afterTabId, {
          ...startup,
          identity: {
            tabId: deterministicAgentSessionUuid(`mobile-chat-fork-tab\0${seed}`),
            leafId: deterministicAgentSessionUuid(`mobile-chat-fork-leaf\0${seed}`)
          },
          createMutation: { clientIdentity, id: mutationId },
          afterDesktopTabId,
          targetGroupId,
          viewMode: 'terminal',
          supportsSplitGroupPlacement: opts.supportsSplitGroupPlacement,
          presentation: 'background',
          signal: opts.signal
        }
      )
      if (!win) return created
      const tab = created.tab
      const pty = typeof tab.terminal === 'string' ? this.getLivePtyForHandle(tab.terminal)?.pty : null
      if (typeof tab.terminal !== 'string' || !pty || !tab.ptyId || !tab.incarnationId ||
        pty.incarnationId !== tab.incarnationId || win.webContents.isDestroyed?.()) {
        return { ...created, warning: 'desktop-tab-not-shown' }
      }
      try {
        if (!this.notifier?.revealTerminalSession) throw new Error('runtime_unavailable')
        const revealed = await this.notifier.revealTerminalSession(worktreeId, {
          ptyId: tab.ptyId,
          tabId: tab.parentTabId,
          leafId: tab.leafId,
          title: pty.title,
          ...(startup.cwd ? { cwd: startup.cwd } : {}),
          ...(pty.launchConfig ? { launchConfig: pty.launchConfig } : {}),
          ...(pty.launchToken ? { launchToken: pty.launchToken } : {}),
          ...(pty.launchAgent ? { launchAgent: pty.launchAgent } : {}),
          viewMode: 'terminal',
          ...(targetGroupId ? { targetGroupId } : {}),
          ...(afterDesktopTabId ? { afterTabId: afterDesktopTabId } : {}),
          ...(launchRuntime.pty.shellOverride
            ? { shellOverride: launchRuntime.pty.shellOverride } : {}),
          activate: false, focus: false, presentation: 'background', surfaceOwner: false,
          expectedProcessIdentity: { terminalHandle: tab.terminal, incarnationId: tab.incarnationId }
        })
        if (!revealed || revealed.tabId !== tab.parentTabId || !revealed.identity ||
          revealed.identity.ptyId !== tab.ptyId ||
          revealed.identity.leafId !== tab.leafId) {
          throw new Error('terminal_reveal_identity_mismatch')
        }
        if (this.getLivePtyForHandle(tab.terminal)?.pty.incarnationId !== tab.incarnationId) {
          throw new Error('terminal_reveal_identity_mismatch')
        }
      } catch (error) {
        console.warn('[mobile-chat-fork] desktop materialization failed:', error)
        return { ...created, warning: 'desktop-tab-not-shown' }
      }
      return created
    } finally {
      releaseThrottle()
    }
  }
}
