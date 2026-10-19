import type { NativeChatMessage } from '../../../src/shared/native-chat-types'
import type { NativeChatLiveLine } from '../../../src/shared/native-chat-live-line'
import type { NativeChatTurnStatus } from './use-mobile-native-chat-turn-status'

export type MobileNativeChatTurnRow = {
  turnStatus: NativeChatTurnStatus | null
  /** The bar renders above the row: its turn has no user bubble of its own. */
  turnStatusAbove?: boolean
  processHidden: boolean
  finalReply: boolean
  turnExpanded: boolean
  /** Set only on a settled turn — the one row that has activity to disclose. */
  turnKey?: string
  activeTurnIsWorking: boolean
  /** The live frontier: the last row where the agent spoke or acted. Only its run is live. */
  trailingRun: boolean
  /** Desktop parity: an unbroken stretch of tool rows and finished thoughts draws as one run,
   *  at its first row. Set on that row: every member, in order. */
  workRun?: readonly NativeChatMessage[]
  /** A later member of a work run, which its first row draws. */
  joinsWorkRun?: boolean
  /** A settled turn folded behind its "Worked for" row hides every row but its answer. */
  foldedAway?: boolean
  /** The reasoning disclosures the reader opened, for the thoughts drawn inside a work run. */
  openReasoning?: ReadonlySet<string>
  /** The newest assistant row of a live turn with no prompt open: its last text may still grow. */
  mayStillGrow: boolean
  /** The live activity line discloses this open reasoning block, so its row draws nothing. */
  reasoningIsLive: boolean
  /** A reasoning row's disclosure, keyed like the live line's so an opened block stays open. */
  reasoningExpanded: boolean
  onToggleReasoning: (key: string) => void
  /** The roster groups the reader opened, by group id; set only on a row that carries one, so a
   *  toggle re-renders roster rows alone. */
  subagentGroupsOpen?: ReadonlySet<string>
  onToggleSubagentGroup: (groupId: string) => void
  userMessageOpen: boolean
  onToggleUserMessage: (messageId: string) => void
}

/** The live activity line, when it draws, and whether the reader opened the block it discloses. */
export type MobileNativeChatLiveLine = NativeChatLiveLine & { reasoningExpanded: boolean }
