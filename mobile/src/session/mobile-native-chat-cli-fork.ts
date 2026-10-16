import { SquareTerminal } from 'lucide-react-native'
import type { ActionSheetAction } from '../components/ActionSheetModal'
import type { MobileSessionController } from './use-mobile-session-controller'
import { agentForksConversations } from '../../../src/shared/agent-resume-argv'
import { AI_VAULT_CHAT_FORK_SOURCE_CAPABILITY } from '../../../src/shared/ai-vault-resume-preparation'
import {
  assertAiVaultCopiedSessionStoreAllowed,
  buildAiVaultForkStartup,
  buildAiVaultLocalResumeStartup,
  getAiVaultResumeCodexHome,
  resolveAiVaultCopiedSessionAgentArgs,
  type AiVaultResumeLaunchSettings,
  type AiVaultResumeStartup
} from '../../../src/shared/ai-vault-resume-startup'
import { isTuiAgent } from '../../../src/shared/tui-agent-config'
import type { TuiAgent } from '../../../src/shared/tui-agent'
import { resolveWindowsShellStartupFamily } from '../../../src/shared/windows-terminal-shell'
import { agentHistoryHostStatusRead } from '../agent-history/mobile-agent-history-operations'
import type { RpcOperationSender } from '../transport/rpc-operation-sender'
import { triggerError } from '../platform/haptics'
import { formatAgentTypeLabel } from '../../../src/shared/agent-type-label'
import { interpretOrThrowRefusalMessage } from '../transport/rpc-refusal-message'
import { optionalSettingsRead } from '../transport/settings-read-operations'
import { readMobileRuntimeTerminalWindowsShell } from './ai-vault-resume-launch'
import { aiVaultChatForkPreparationRun } from './mobile-session-launch-operations'

// An agent's own fork command, or the chat host writing a copy, can take this long.
const CHAT_FORK_PREPARATION_TIMEOUT_MS = 90_000
const CHAT_FORK_READ_TIMEOUT_MS = 30_000

/**
 * Whether a phone chat tab offers "Resume in New CLI". The host owns the rest of the decision (and
 * refuses WSL chats); SSH workspaces never have a chat tab. A server workspace reached through the
 * desktop is hidden because the desktop answers this preparation for its own chats only.
 */
export function canOfferMobileNativeChatCliFork(args: {
  agent: string
  hostCapabilities: readonly string[] | undefined
  workspaceOnPairedHost: boolean
}): boolean {
  return (
    args.workspaceOnPairedHost &&
    agentForksConversations(args.agent) &&
    args.hostCapabilities?.includes(AI_VAULT_CHAT_FORK_SOURCE_CAPABILITY) === true
  )
}

export type MobileNativeChatCliForkLaunch = AiVaultResumeStartup & { launchAgent?: TuiAgent }

/** What a resume sends with its startup command when the phone creates its terminal. */
export type MobileTerminalResumeLaunch = Pick<
  MobileNativeChatCliForkLaunch,
  'cwd' | 'env' | 'envToDelete' | 'launchConfig' | 'launchAgent'
>

/** Has the chat's host prepare its conversation, then builds the terminal startup that opens it. */
export async function prepareMobileNativeChatCliFork(
  client: RpcOperationSender,
  chat: { sessionId: string; worktreeId: string }
): Promise<MobileNativeChatCliForkLaunch> {
  const [prepared, statusReply, settingsReply] = await Promise.all([
    aiVaultChatForkPreparationRun.request(
      client,
      { sourceChat: { sessionId: chat.sessionId, workspaceId: chat.worktreeId }, fork: true },
      { timeoutMs: CHAT_FORK_PREPARATION_TIMEOUT_MS }
    ),
    agentHistoryHostStatusRead
      .request(client, undefined, { timeoutMs: CHAT_FORK_READ_TIMEOUT_MS })
      .catch(() => null),
    optionalSettingsRead
      .request(client, undefined, { timeoutMs: CHAT_FORK_READ_TIMEOUT_MS })
      .catch(() => null)
  ])
  const { source, copied } = interpretOrThrowRefusalMessage(
    () => aiVaultChatForkPreparationRun.interpret(prepared),
    'Could not prepare this conversation.'
  )
  const settingsResult = settingsReply ? optionalSettingsRead.interpret(settingsReply) : null
  const settings = settingsResult?.accepted
    ? // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: settings stay opaque on the phone; the builder reads only optional launch records.
      (settingsResult.value as AiVaultResumeLaunchSettings | null | undefined)
    : null
  const platform = source.executionHostPlatform
  let statusResult: unknown = null
  try {
    statusResult = statusReply ? agentHistoryHostStatusRead.interpret(statusReply) : null
  } catch {
    // An unreadable status only loses the Windows shell, which falls back to PowerShell.
  }
  const args = {
    session: source,
    host: {
      platform,
      codexHome: getAiVaultResumeCodexHome(source.codexHome, platform),
      // The command runs in the host's live shell, not one the phone picks.
      liveShell:
        platform === 'win32'
          ? resolveWindowsShellStartupFamily(readMobileRuntimeTerminalWindowsShell(statusResult))
          : undefined
    },
    settings
  }
  assertAiVaultCopiedSessionStoreAllowed(args)
  const startup = copied
    ? {
        ...buildAiVaultLocalResumeStartup({
          ...args,
          agentArgs: resolveAiVaultCopiedSessionAgentArgs({
            ...args,
            sourceAgent: source.sourceAgent
          }),
          embedCwd: false
        }),
        agent: source.agent
      }
    : buildAiVaultForkStartup(args)
  if (!startup) {
    throw new Error('This session cannot be opened in the CLI.')
  }
  return isTuiAgent(source.agent) ? { ...startup, launchAgent: source.agent } : startup
}

const pendingSessionIds = new Set<string>()

/** One tap, one copy: a second tap while the host prepares does nothing. */
export async function runMobileNativeChatCliFork(args: {
  client: RpcOperationSender
  worktreeId: string
  tab: { sessionId: string; agent: string }
  createTerminal: (options: {
    startupCommand: string
    resumeLaunch: MobileTerminalResumeLaunch
    errorToast: string
  }) => Promise<void>
  showToast: (message: string, durationMs?: number) => void
}): Promise<void> {
  const { sessionId, agent } = args.tab
  if (pendingSessionIds.has(sessionId)) {
    return
  }
  pendingSessionIds.add(sessionId)
  const failure = `Could not open this ${formatAgentTypeLabel(agent)} chat in a new CLI.`
  try {
    const { command, cwd, env, envToDelete, launchConfig, launchAgent } =
      await prepareMobileNativeChatCliFork(args.client, { sessionId, worktreeId: args.worktreeId })
    await args.createTerminal({
      startupCommand: command,
      resumeLaunch: {
        ...(cwd ? { cwd } : {}),
        ...(env ? { env } : {}),
        ...(envToDelete ? { envToDelete } : {}),
        ...(launchConfig ? { launchConfig } : {}),
        ...(launchAgent ? { launchAgent } : {})
      },
      errorToast: failure
    })
  } catch (error) {
    triggerError()
    args.showToast(
      error instanceof Error && error.message ? `${failure} ${error.message}` : failure,
      2400
    )
  } finally {
    pendingSessionIds.delete(sessionId)
  }
}

/** The chat tab menu's item, above Close, matching the desktop tab menu. */
export function getMobileNativeChatCliForkActions(args: {
  controller: Pick<
    MobileSessionController,
    'client' | 'worktreeId' | 'hostCapabilities' | 'handleCreateTerminal' | 'showToast'
  >
  tab: { sessionId: string; agent: string } | null
  workspaceOnPairedHost: boolean
  onDismiss: () => void
}): ActionSheetAction[] {
  const { client, worktreeId, hostCapabilities, handleCreateTerminal, showToast } = args.controller
  const { tab } = args
  if (
    !client ||
    !tab ||
    !canOfferMobileNativeChatCliFork({
      agent: tab.agent,
      hostCapabilities,
      workspaceOnPairedHost: args.workspaceOnPairedHost
    })
  ) {
    return []
  }
  return [
    {
      label: 'Resume in New CLI',
      icon: SquareTerminal,
      onPress: () => {
        args.onDismiss()
        void runMobileNativeChatCliFork({
          client,
          worktreeId,
          tab,
          createTerminal: (options) => handleCreateTerminal(undefined, options),
          showToast
        })
      }
    }
  ]
}
