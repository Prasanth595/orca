export type AgentSessionOptionChoice = {
  value: string
  label: string
  description?: string
}

/** Model parameters a listing offers apart from effort (Cursor's context size and thinking). */
export type AgentSessionModelParameterOptions = {
  /** Context-window sizes the model offers, when the listing names more than one. */
  contextWindows?: AgentSessionOptionChoice[]
  defaultContextWindow?: string
  /** Thinking on/off (or levels), when the listing offers them separately from effort. */
  thinkingLevels?: AgentSessionOptionChoice[]
  defaultThinking?: string
}

/** Cursor's current next-turn picks for those parameters. Absent on Claude and Codex. */
export type AgentSessionCurrentModelParameters = {
  context?: string
  thinking?: string
  /** Cursor structured chat: agent or plan. */
  conversationMode?: 'agent' | 'plan'
}

export type AgentSessionModelOption = AgentSessionModelParameterOptions & {
  id: string
  label: string
  description?: string
  isDefault: boolean
  defaultEffort?: string
  efforts: AgentSessionOptionChoice[]
  /** Provider catalog fact. Absent means the host could not determine support. */
  supportsFastMode?: boolean
  /** Whether the model runs Approve for me; absent is unknown, which neither offers nor launches it. */
  supportsAutoMode?: boolean
  /** Service tiers the provider lists for this model besides its standard one, each valued by the
   *  provider's own tier id. Absent means unknown; a client that reads it offers one speed choice
   *  (`default` for standard) in place of the Fast toggle. */
  serviceTiers?: AgentSessionOptionChoice[]
}
