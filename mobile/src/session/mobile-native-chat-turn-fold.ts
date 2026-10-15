import { AGENT_SESSION_ORCA_STOP_PRESENTATION } from '../../../src/shared/agent-session-orca-stop'
import { AGENT_SESSION_COMPACTION_SKIPPED_PRESENTATION } from '../../../src/shared/agent-session-compaction'
import {
  deriveNativeChatRowContent,
  nativeChatRowRendersContent
} from '../../../src/shared/native-chat-row-content'
import { isStoppedBeforeStartBlock } from '../../../src/shared/native-chat-stopped-before-start'
import {
  isBackgroundTaskBlock,
  isSubagentGroupBlock,
  type NativeChatMessage
} from '../../../src/shared/native-chat-types'
import {
  nativeChatTurnFold,
  nativeChatTurnAnswerRows
} from '../../../src/shared/native-chat-turn-fold'
import type { NativeChatTurnStatus } from '../../../src/shared/native-chat-turn-status'

/** Use the desktop's turn fold while deriving prose from the phone's rendered blocks. */
export function mobileNativeChatTurnFold(
  messages: readonly NativeChatMessage[],
  turnKeys: readonly (string | undefined)[],
  completed: Readonly<Record<string, NativeChatTurnStatus>>,
  expandedTurnKeys: ReadonlySet<string>
) {
  const rows = messages.map((message, index) => {
    const content = deriveNativeChatRowContent(message.blocks)
    return {
      turnKey: turnKeys[index],
      role: message.role,
      rendersProse: content.markdown.length > 0 || content.hasImages,
      draws: nativeChatRowRendersContent(message.blocks),
      outlivesTurn: message.blocks.some(
        (block) =>
          isSubagentGroupBlock(block) ||
          isBackgroundTaskBlock(block) ||
          isStoppedBeforeStartBlock(block)
      ),
      reportsFailure: message.blocks.some(
        (block) =>
          block.type === 'text' &&
          block.tone === 'error' &&
          block.presentation !== AGENT_SESSION_ORCA_STOP_PRESENTATION
      ),
      explainsTurn: message.blocks.some(
        (block) =>
          block.type === 'text' &&
          (block.presentation === 'compaction' ||
            block.presentation === AGENT_SESSION_COMPACTION_SKIPPED_PRESENTATION ||
            block.presentation === AGENT_SESSION_ORCA_STOP_PRESENTATION)
      )
    }
  })
  const settledTurnKeys = new Set(
    Object.entries(completed)
      .filter(([, status]) => status.workedSeconds != null)
      .map(([key]) => key)
  )
  const fold = nativeChatTurnFold({ rows, settledTurnKeys, expandedTurnKeys })
  return {
    ...fold,
    answerIds: new Set(
      [...nativeChatTurnAnswerRows(rows)]
        .filter(([key]) => settledTurnKeys.has(key))
        .map(([, index]) => messages[index]!.id)
    )
  }
}
