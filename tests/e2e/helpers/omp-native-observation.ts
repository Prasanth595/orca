export type NativeRef = {
  id: string
  kind: string
  parentId?: string
  status: string
  sessionId?: string
  sessionFile?: string
  createdAt?: number
  isStreaming?: boolean
  pendingAsync?: boolean
  terminalAt?: number
  rootManager: boolean
}

export type NativeObservation = {
  at: number
  kind: string
  name?: string
  id?: string
  toolName?: string
  status?: string
  agentKind?: string
  sessionId?: string
  sessionFile?: string
  managerId?: number
  rootState?: string
  willContinue?: boolean
  asyncJobId?: string
  asyncState?: string
  ownerMatches?: boolean
  refs?: NativeRef[]
  hookEvent?: string
  accepted?: boolean
  subagentIds?: string[]
}
