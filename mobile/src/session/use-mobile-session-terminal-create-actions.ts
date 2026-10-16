import {
  buildMobileQuickCommandLaunch,
  type MobileQuickCommandLaunch
} from '../terminal/quick-commands'
import type { RpcFailure, RpcSuccess } from '../transport/types'
import { sessionTabCreateTerminal } from './mobile-session-write-operations'
import { triggerSuccess, triggerError } from '../platform/haptics'
import { buildTerminalSendParams } from '../terminal/terminal-send-request'
import { terminalRecordsEqual } from './mobile-terminal-records'
import type { MobileNewTabAgentOption } from './mobile-new-tab-agent-options'
import type { TerminalQuickCommand } from '../../../src/shared/terminal-quick-command-types'
import type { MobileSessionTab, Terminal } from './mobile-session-route-types'
import type { MobileSessionAttachmentsModel } from './use-mobile-session-attachments'
import { isAgentSessionHandleProvider } from '../../../src/shared/agent-session-provider-handle'
import { createMobileStructuredAgentSession } from './mobile-structured-agent-session-launch'
import { launchesThroughHost, launchNewTabAgentThroughHost } from './new-tab-agent-host-launch'
import {
  launchedSelection,
  withLaunchReply,
  withoutUnansweredLaunch,
  withoutPendingHandle
} from './pending-session-selection'
import { releaseTerminalCreateLock } from './terminal-create-lock'
import { placeCreatedSessionTab } from '../../../src/shared/session-tab-placement'
import {
  SESSION_TABS_SPLIT_GROUP_PLACEMENT_RUNTIME_CAPABILITY,
  STRUCTURED_AGENT_SESSION_CLIENT_LAUNCH_MODE_CAPABILITY
} from '../../../src/shared/protocol-version'

export function useMobileSessionTerminalCreateActions(scope: MobileSessionAttachmentsModel) {
  const {
    worktreeId,
    client,
    hostCapabilities,
    connState,
    setTerminals,
    terminalsRef,
    setSessionTabs,
    sessionTabsRef,
    defaultTerminalHandlesToLiveInput,
    setActiveHandle,
    activeSessionTabId,
    setActiveSessionTabId,
    setCreating,
    creatingTerminalRef,
    creatingBrowser,
    creatingMarkdown,
    setCreateError,
    deviceTokenRef,
    activeHandleRef,
    activeSessionTabTypeRef,
    pendingSelectionRef,
    scheduleDelayedAction,
    showToast,
    unsubscribeTerminal,
    subscribeToTerminal,
    fetchSessionTabs
  } = scope
  async function handleCreateTerminal(
    agent?: MobileNewTabAgentOption['agent'],
    options?: MobileQuickCommandLaunch['options'] & {
      onPromptSent?: () => void
      errorToast?: string
    }
  ) {
    if (!client || creatingTerminalRef.current) {
      return
    }
    // Why: idempotency key so a transport retry (reconnect replay) resolves to the same terminal, not a duplicate; kept compact (no worktree id) for the schema length cap.
    const clientMutationId = `mobile-create:${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 10)}`
    // Also names the "+" lock, which a launch frees when its tab lands.
    creatingTerminalRef.current = clientMutationId

    setCreating(true)
    setCreateError('')

    // Why: the host names the real cause (pty exhaustion, disabled agent, unresolved worktree);
    // collapsing every failure to 'Failed to create terminal' left the phone undiagnosable.
    function reportCreateFailure(hostReason: string): void {
      const reason = hostReason.trim() || options?.errorToast || 'Failed to create terminal'
      setCreateError(reason)
      // Why: the inline error renders only in an empty session; beside open tabs only a toast is seen.
      triggerError()
      showToast(options?.errorToast ?? reason, 1800)
    }

    async function launchStructured(): Promise<boolean> {
      if (!client || !isAgentSessionHandleProvider(agent) || options !== undefined) {
        return false
      }
      pendingSelectionRef.current = launchedSelection(clientMutationId, {}, null)
      const structured = await createMobileStructuredAgentSession(client, worktreeId, agent)
      if (structured.kind === 'created') {
        pendingSelectionRef.current = withLaunchReply(
          pendingSelectionRef.current,
          clientMutationId,
          {
            sessionId: structured.sessionId
          }
        )
        void fetchSessionTabs()
        return true
      }
      if (structured.kind === 'unknown' || structured.kind === 'failed') {
        reportCreateFailure(structured.message)
        return true
      }
      return false
    }

    try {
      // Older SSH runtimes drop agent.launch's mode field; create is already client-controlled.
      if (
        hostCapabilities?.includes(STRUCTURED_AGENT_SESSION_CLIENT_LAUNCH_MODE_CAPABILITY) &&
        (await launchStructured())
      ) {
        return
      }
      if (
        agent &&
        launchesThroughHost(options) &&
        (await launchNewTabAgentThroughHost({
          client,
          hostCapabilities,
          worktreeId,
          agent,
          options,
          lock: clientMutationId,
          activeSessionTabId,
          pendingSelectionRef,
          fetchSessionTabs,
          getSessionTabs: () => sessionTabsRef.current,
          showToast,
          reportCreateFailure,
          setCreateError
        }))
      ) {
        return
      }
      if (await launchStructured()) {
        return
      }
      const afterTabId = activeSessionTabId ?? undefined
      const hostSupportsGroupedPlacement =
        hostCapabilities?.includes(SESSION_TABS_SPLIT_GROUP_PLACEMENT_RUNTIME_CAPABILITY) === true
      const response = await sessionTabCreateTerminal.request(client, {
        worktree: `id:${worktreeId}`,
        afterTabId,
        clientMutationId,
        ...(options?.startupCommand ? { command: options.startupCommand } : {}),
        ...(options?.startupCommandDelivery
          ? { startupCommandDelivery: options.startupCommandDelivery }
          : {}),
        ...(options?.agentPrompt ? { agentPrompt: options.agentPrompt } : {}),
        ...(agent ? { agent } : {}),
        activate: false,
        select: true,
        navigation: 'caller'
      })
      // Why interpret here rather than branching: a refused create throws the host's message,
      // which the catch below reports exactly as the old `else` branch did.
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Preserve the established response shape at this boundary.
      const created = sessionTabCreateTerminal.interpret(response) as Extract<
        MobileSessionTab,
        { type: 'terminal' }
      >
      // Why: unsubscribe the old terminal so the server restores its desktop dims; otherwise its restore timer is never set.
      const prev = activeHandleRef.current
      if (prev) {
        unsubscribeTerminal(prev)
      }
      pendingSelectionRef.current = { kind: 'tab', tabId: created.id }
      activeSessionTabTypeRef.current = 'terminal'
      setActiveSessionTabId(created.id)
      // An older headed host places after the parent while an older headless host places after the
      // leaf. Without the capability, wait for the host snapshot instead of guessing.
      if (hostSupportsGroupedPlacement) {
        setSessionTabs((prev) => {
          if (prev.some((tab) => tab.id === created.id)) {
            return prev
          }
          return placeCreatedSessionTab(prev, { ...created, isActive: true }, afterTabId, {
            afterParentGroup: true
          })
        })
      }
      if (typeof created.terminal === 'string') {
        const createdHandle = created.terminal
        defaultTerminalHandlesToLiveInput([createdHandle])
        // Why: snapshots lag the create RPC; without this marker applySessionTabs reverts the active handle, blanking the new pane.
        pendingSelectionRef.current = { kind: 'terminal', handle: createdHandle, tabId: created.id }
        activeHandleRef.current = createdHandle
        setActiveHandle(createdHandle)
        setTerminals((prev) => {
          const existing = prev.find((terminal) => terminal.handle === createdHandle)
          const createdTerminal: Terminal = {
            handle: createdHandle,
            title: created.title || existing?.title || 'Terminal',
            terminalTheme: created.terminalTheme ?? existing?.terminalTheme,
            isActive: true
          }
          if (existing) {
            const next = prev.map((terminal) =>
              terminal.handle === createdHandle ? { ...terminal, ...createdTerminal } : terminal
            )
            terminalsRef.current = next
            return terminalRecordsEqual(prev, next) ? prev : next
          }
          const next = [...prev, createdTerminal]
          terminalsRef.current = next
          return next
        })
        subscribeToTerminal(createdHandle)
        if (options?.initialPrompt?.trim()) {
          void client
            .sendRequest(
              'terminal.send',
              buildTerminalSendParams({
                terminal: createdHandle,
                text: options.initialPrompt,
                enter: options.enter !== false,
                deviceToken: deviceTokenRef.current
              })
            )
            .then((sendResponse) => {
              if (!sendResponse.ok) {
                throw new Error(
                  (sendResponse as RpcFailure).error.message || 'Failed to send notes'
                )
              }
              const result = (sendResponse as RpcSuccess).result as {
                send?: { accepted?: boolean }
              }
              if (result.send?.accepted === false) {
                throw new Error('Terminal input is locked by another client.')
              }
              triggerSuccess()
              showToast(options.successToast ?? 'Notes sent')
              options.onPromptSent?.()
            })
            .catch((err) => {
              triggerError()
              showToast(
                options.errorToast ?? (err instanceof Error ? err.message : "Couldn't send notes"),
                1800
              )
            })
        } else if (options?.successToast) {
          triggerSuccess()
          showToast(options.successToast)
        }
      } else {
        // Why: a prior pending handle must not outlive a create that returned no terminal; web-ready subscribe gates on this ref.
        pendingSelectionRef.current = withoutPendingHandle(pendingSelectionRef.current)
        activeHandleRef.current = null
        setActiveHandle(null)
      }
      scheduleDelayedAction(() => void fetchSessionTabs(), 500)
    } catch (error) {
      reportCreateFailure(error instanceof Error ? error.message : '')
    } finally {
      pendingSelectionRef.current = withoutUnansweredLaunch(
        pendingSelectionRef.current,
        clientMutationId
      )
      releaseTerminalCreateLock({ creatingTerminalRef, setCreating }, clientMutationId)
    }
  }

  // Quick commands spawn a fresh terminal tab, mirroring desktop's
  // run-quick-command-in-new-tab: agent prompts and runnable terminal commands
  // use the host's shell-ready startup path; insert-only commands stay drafts.
  function launchQuickCommand(command: TerminalQuickCommand): boolean {
    if (
      !client ||
      connState !== 'connected' ||
      creatingTerminalRef.current ||
      creatingBrowser ||
      creatingMarkdown
    ) {
      return false
    }
    const launch = buildMobileQuickCommandLaunch(command)
    if (!launch) {
      triggerError()
      showToast('Edit this quick command before running it', 1800)
      return false
    }
    const label = command.label.trim() || 'Quick command'
    void handleCreateTerminal(launch.agent, {
      ...launch.options,
      errorToast: `Couldn't run ${label}`
    })
    return true
  }
  return {
    handleCreateTerminal,
    launchQuickCommand
  }
}

export type MobileSessionTerminalCreateActionsModel = MobileSessionAttachmentsModel &
  ReturnType<typeof useMobileSessionTerminalCreateActions>
