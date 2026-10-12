export type AutomationSemanticEvaluationMode = 'shadow' | 'enforced'

export type AutomationSemanticEvaluationChoice =
  | 'requirements_satisfied'
  | 'requirements_not_satisfied'
  | 'insufficient_evidence'

export type AutomationSemanticEvaluationConfig = {
  evaluator: 'jev'
  mode: AutomationSemanticEvaluationMode
  /** Absolute or workspace-relative path to a versioned rubric JSON file. */
  rubricPath: string
}

export type AutomationSemanticEvaluationReceipt = {
  evaluator: 'jev'
  mode: AutomationSemanticEvaluationMode
  model: string
  rubricId: string
  rubricVersion: string
  rubricSha256: string
  stateSha256: string
  choice: AutomationSemanticEvaluationChoice
  probabilities: Record<AutomationSemanticEvaluationChoice, number>
  confidence: number
  minimumConfidence: number
  evidenceRefs: string[]
  recordedAt: number
  source: 'evaluator'
}

export type AutomationSemanticEvaluationResult = Omit<
  AutomationSemanticEvaluationReceipt,
  'recordedAt' | 'source'
>
