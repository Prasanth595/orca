import type { WriteSettlement } from '../../shared/pty-write-settlement'

export class AgentPromptWriteSettlementError extends Error {
  constructor(readonly settlement: WriteSettlement) {
    super(`agent_prompt_write_${settlement.outcome}`)
    this.name = 'AgentPromptWriteSettlementError'
  }
}
