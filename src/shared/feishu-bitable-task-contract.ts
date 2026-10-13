export type FeishuBitableRecordReference = {
  connectionId: string
  appToken: string
  tableId: string
  recordId: string
}

export type FeishuBitableTaskSnapshot = {
  source: FeishuBitableRecordReference
  title: string
  description: string
  acceptanceCriteria?: string
  url?: string
}

export type FeishuBitableExecutionInput = {
  task: FeishuBitableTaskSnapshot
  userInstruction?: string
}

export type FeishuBitableExecutionPlan = {
  source: FeishuBitableRecordReference
  prompt: string
  suggestedWorkspaceName: string
  taskSpec: string
}
