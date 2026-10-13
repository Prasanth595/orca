import { toast } from 'sonner'
import { describeAiVaultResumeFailure } from '@/lib/ai-vault-resume-refusal'
import { translate } from '@/i18n/i18n'
import { agentLabel } from './ai-vault-session-filters'
import type { AiVaultAgent } from '../../../../shared/ai-vault-types'

export function notifyAiVaultSessionQueued(agent: AiVaultAgent): void {
  toast.success(
    translate(
      'auto.components.right.sidebar.AiVaultPanel.agentSessionQueued',
      '{{value0}} session queued',
      { value0: agentLabel(agent) }
    )
  )
}

export function notifyAiVaultSessionPreparationFailure(
  error: unknown,
  agent: AiVaultAgent,
  describeFailure: (message: string) => string = (message) => message
): void {
  const described = error instanceof Error ? new Error(describeFailure(error.message)) : error
  toast.error(describeAiVaultResumeFailure(described, agent))
}
