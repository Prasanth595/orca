export type NativeRef = {
  id: string
  kind: string
  parentId?: string
  status: string
  sessionId?: string
  sessionFile?: string
  createdAt?: number
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
  rootToolName?: string
  rootPrompt?: string
  rootText?: string
  rootBoundary?: boolean
  ownerMatches?: boolean
  refs?: NativeRef[]
  hookEvent?: string
  accepted?: boolean
  subagents?: {
    id: string
    agentType?: string
    description?: string
    state: string
    startedAt: number
  }[]
}
