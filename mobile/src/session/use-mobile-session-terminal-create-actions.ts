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
import { useEffect, useRef } from 'react'
import { SESSION_TABS_CHAT_FORK_CLI_RUNTIME_CAPABILITY } from '../../../src/shared/session-tabs-runtime-capabilities'
import { formatAgentTypeLabel } from '../../../src/shared/agent-type-label'
import { isRpcDeliveryUnknown } from '../transport/rpc-delivery-ambiguity'
import { isLogicalClientCutoverError } from '../transport/stable-logical-rpc-client'
import { RpcIncompatibleReplyError } from '../transport/rpc-incompatible-reply-error'
import { createdTerminalDesktopWarning } from './session-write-reply-schema'
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
import { SESSION_TABS_SPLIT_GROUP_PLACEMENT_RUNTIME_CAPABILITY } from '../../../src/shared/protocol-version'

export function useMobileSessionTerminalCreateActions(scope: MobileSessionAttachmentsModel) {
  const {
    hostId,
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
  const routeActivationRef = useRef<symbol | null>(null)
  useEffect(() => {
    const activation = Symbol('session-create-route')
    routeActivationRef.current = activation
    return () => {
      if (routeActivationRef.current === activation) {
        routeActivationRef.current = null
        creatingTerminalRef.current = null
        setCreating(false)
      }
    }
  }, [hostId, worktreeId, client, creatingTerminalRef, setCreating])

  type CreateOutcome = 'created' | 'accepted' | 'busy' | 'unavailable' | 'reported-failure'
  async function handleCreateTerminal(
    agent?: MobileNewTabAgentOption['agent'],
    options?: MobileQuickCommandLaunch['options'] & {
      onPromptSent?: () => void
      errorToast?: string
      sourceChatFork?: { sessionId: string; agent: string }
    }
  ): Promise<CreateOutcome> {
    const sourceFork = options?.sourceChatFork
    const agentName = sourceFork ? formatAgentTypeLabel(sourceFork.agent) : ''
    const activation = routeActivationRef.current
    const isRouteCurrent = () => activation !== null && routeActivationRef.current === activation
    const isCurrent = () => isRouteCurrent() &&
      (!sourceFork || sessionTabsRef.current.some((tab) =>
        tab.type === 'agent-session' && tab.sessionId === sourceFork.sessionId
      ))
    const reportFork = (message: string): void => {
      if (!isCurrent()) return
      setCreateError(message)
      triggerError()
      showToast(message, 3000)
    }
    if (!client || (sourceFork && (
      !hostCapabilities?.includes(SESSION_TABS_CHAT_FORK_CLI_RUNTIME_CAPABILITY) || !isCurrent()
    ))) {
      if (sourceFork) reportFork(`Open the ${agentName} chat on a connected, updated host and try again.`)
      return 'unavailable'
    }
    if (creatingTerminalRef.current) {
      if (sourceFork) reportFork(`Another terminal is opening. Wait, then retry the ${agentName} chat.`)
      return 'busy'
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
      if (!isCurrent()) return
      const reason = hostReason.trim() || options?.errorToast || 'Failed to create terminal'
      setCreateError(reason)
      // Why: the inline error renders only in an empty session; beside open tabs only a toast is seen.
      triggerError()
      showToast(options?.errorToast ?? reason, 1800)
    }

    try {
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
        return 'accepted'
      }
      // COMPAT(agent.launch.v2): hosts before v1.4.206 keep the paths below; remove once none remain.
      // Bare structured-provider launches follow host createSupport; prompted launches keep their startup semantics.
      if (isAgentSessionHandleProvider(agent) && options === undefined) {
        // Armed before asking with nothing to match yet, so a tab picked meanwhile still wins.
        pendingSelectionRef.current = launchedSelection(clientMutationId, {}, null)
        const structured = await createMobileStructuredAgentSession(client, worktreeId, agent)
        if (structured.kind === 'created') {
          // Found by session in the next snapshot, never by a predicted tab id; the current tab stays
          // live until then, as on the launch path above.
          const reply = { sessionId: structured.sessionId }
          pendingSelectionRef.current = withLaunchReply(
            pendingSelectionRef.current,
            clientMutationId,
            reply
          )
          void fetchSessionTabs()
          return 'accepted'
        }
        if (structured.kind === 'unknown') {
          // Never create a legacy sibling when the host may already have committed.
          setCreateError(structured.message)
          triggerError()
          showToast(structured.message, 1800)
          return 'reported-failure'
        }
      }
      const afterTabId = activeSessionTabId ?? undefined
      const hostSupportsGroupedPlacement =
        hostCapabilities?.includes(SESSION_TABS_SPLIT_GROUP_PLACEMENT_RUNTIME_CAPABILITY) === true
      const createParams = {
        worktree: `id:${worktreeId}`,
        afterTabId,
        clientMutationId,
        ...(options?.startupCommand ? { command: options.startupCommand } : {}),
        ...(options?.startupCommandDelivery
          ? { startupCommandDelivery: options.startupCommandDelivery }
          : {}),
        ...(options?.agentPrompt ? { agentPrompt: options.agentPrompt } : {}),
        ...(agent ? { agent } : {}),
        ...(sourceFork ? { sourceChatFork: { sessionId: sourceFork.sessionId } } : {}),
        activate: false,
        select: true,
        navigation: 'caller' as const
      }
      const response = sourceFork
        ? await sessionTabCreateTerminal.request(client, createParams, { timeoutMs: 120_000 })
        : await sessionTabCreateTerminal.request(client, createParams)
      if (!isCurrent()) return 'accepted'
      if (sourceFork && response.kind === 'outer-refused') {
        const code = response.error.code
        const guidance = code === 'chat_fork_anchor_changed'
          ? 'Select a tab and try again.'
          : code === 'chat_fork_runtime_incompatible'
            ? 'Open the chat in a native workspace on its host and try again.'
            : code === 'chat_fork_source_unavailable'
              ? 'Reopen the saved chat and try again.'
              : 'Reconnect and check open tabs on the host before retrying.'
        reportFork(`Could not open ${agentName} in a new CLI. ${guidance}`)
        return 'reported-failure'
      }
      if (sourceFork && response.kind === 'incompatible') {
        reportFork(`${agentName} may have opened. Reconnect and check open tabs on the host before retrying.`)
        return 'reported-failure'
      }
      // Why interpret here rather than branching: a refused create throws the host's message,
      // which the catch below reports exactly as the old `else` branch did.
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Preserve the established response shape at this boundary.
      const created = sessionTabCreateTerminal.interpret(response) as Extract<
        MobileSessionTab,
        { type: 'terminal' }
      >
      if (!isCurrent()) return 'accepted'
      if (sourceFork && response.raw.ok && createdTerminalDesktopWarning(response.raw.result)) {
        reportFork(`${agentName} opened in a CLI, but its desktop tab could not be shown. Check open tabs on the host before retrying.`)
      }
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
          if (!isCurrent()) return prev
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
          if (!isCurrent()) return prev
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
      scheduleDelayedAction(() => { if (isCurrent()) void fetchSessionTabs() }, 500)
      return 'created'
    } catch (error) {
      if (sourceFork) {
        reportFork(isRpcDeliveryUnknown(error) || isLogicalClientCutoverError(error) || error instanceof RpcIncompatibleReplyError
          ? `${agentName} may have opened. Reconnect and check open tabs on the host before retrying.`
          : `Could not open ${agentName} in a new CLI. Check the chat and host settings, then try again.`)
        return 'reported-failure'
      }
      reportCreateFailure(error instanceof Error ? error.message : '')
      return 'reported-failure'
    } finally {
      if (isRouteCurrent()) {
        pendingSelectionRef.current = withoutUnansweredLaunch(
          pendingSelectionRef.current,
          clientMutationId
        )
        releaseTerminalCreateLock({ creatingTerminalRef, setCreating }, clientMutationId)
      }
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
