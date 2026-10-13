import { describe, expect, it, vi } from 'vitest'
import type { PersistedState } from '../../../shared/persisted-state-types'
import {
  listAutomationRunsPage,
  recordAutomationSemanticEvaluation,
  recordAutomationWorkflowReceipt
} from './automation-run-operations'

function stateWithRuns(runs: { id: string; createdAt: number }[]): PersistedState {
  return {
    automationRuns: runs.map((run) => ({ ...run, automationId: 'a1' }))
  } as PersistedState
}

describe('listAutomationRunsPage', () => {
  it('returns a bounded, newest-first page and an opaque continuation cursor', () => {
    const state = stateWithRuns([
      { id: 'old', createdAt: 1 },
      { id: 'new', createdAt: 3 },
      { id: 'middle', createdAt: 2 }
    ])

    const first = listAutomationRunsPage(state, 'a1', 2)
    expect(first.runs.map((run) => run.id)).toEqual(['new', 'middle'])
    expect(first.nextCursor).not.toBeNull()

    expect(listAutomationRunsPage(state, 'a1', 2, first.nextCursor ?? undefined)).toEqual(
      expect.objectContaining({
        runs: [expect.objectContaining({ id: 'old' })],
        nextCursor: null
      })
    )
  })

  it('keeps the window stable when a newer run lands between pages', () => {
    const state = stateWithRuns([
      { id: 'r1', createdAt: 1 },
      { id: 'r2', createdAt: 2 },
      { id: 'r3', createdAt: 3 }
    ])

    const first = listAutomationRunsPage(state, 'a1', 2)
    expect(first.runs.map((run) => run.id)).toEqual(['r3', 'r2'])

    state.automationRuns = [
      ...state.automationRuns,
      { id: 'r4', automationId: 'a1', createdAt: 4 } as PersistedState['automationRuns'][number]
    ]

    const second = listAutomationRunsPage(state, 'a1', 2, first.nextCursor ?? undefined)
    expect(second.runs.map((run) => run.id)).toEqual(['r1'])
    expect(second.nextCursor).toBeNull()
  })

  it('resumes after a pruned boundary run instead of restarting the page', () => {
    const state = stateWithRuns([
      { id: 'r1', createdAt: 1 },
      { id: 'r2', createdAt: 2 },
      { id: 'r3', createdAt: 3 }
    ])
    const first = listAutomationRunsPage(state, 'a1', 2)

    state.automationRuns = state.automationRuns.filter((run) => run.id !== 'r2')

    expect(
      listAutomationRunsPage(state, 'a1', 2, first.nextCursor ?? undefined).runs.map(
        (run) => run.id
      )
    ).toEqual(['r1'])
  })

  it('keeps runs tied on createdAt when the boundary run is pruned', () => {
    const state = stateWithRuns([
      { id: 'r2', createdAt: 10 },
      { id: 'r1', createdAt: 10 },
      { id: 'r0', createdAt: 5 }
    ])
    const first = listAutomationRunsPage(state, 'a1', 1)
    expect(first.runs.map((run) => run.id)).toEqual(['r1'])

    state.automationRuns = state.automationRuns.filter((run) => run.id !== 'r1')

    expect(
      listAutomationRunsPage(state, 'a1', 2, first.nextCursor ?? undefined).runs.map(
        (run) => run.id
      )
    ).toEqual(['r2', 'r0'])
  })

  it('still honours a legacy offset cursor issued before the upgrade', () => {
    const state = stateWithRuns([
      { id: 'r1', createdAt: 1 },
      { id: 'r2', createdAt: 2 },
      { id: 'r3', createdAt: 3 }
    ])

    expect(listAutomationRunsPage(state, 'a1', 2, '2').runs.map((run) => run.id)).toEqual(['r1'])
  })

  it('applies status and time filters before pagination', () => {
    const state = stateWithRuns([
      { id: 'old-failure', createdAt: 1 },
      { id: 'new-success', createdAt: 3 },
      { id: 'new-failure', createdAt: 2 }
    ])
    state.automationRuns = state.automationRuns.map((run) => ({
      ...run,
      status: run.id === 'new-success' ? 'completed' : 'dispatch_failed'
    }))

    expect(listAutomationRunsPage(state, 'a1', 1, undefined, 'dispatch_failed', 2)).toEqual({
      runs: [expect.objectContaining({ id: 'new-failure' })],
      nextCursor: null
    })
  })
})

describe('recordAutomationWorkflowReceipt', () => {
  it('is idempotent for the same receipt and refuses contradictory rewrites', () => {
    const state = stateWithRuns([{ id: 'run-1', createdAt: 1 }])
    const flush = vi.fn()
    const operations = {
      state,
      flush,
      recordManualRun: vi.fn(),
      getWorkspaceDisplayName: () => null
    }

    const first = recordAutomationWorkflowReceipt(
      operations,
      'run-1',
      'passed',
      '  artifact validated  '
    )
    const second = recordAutomationWorkflowReceipt(
      operations,
      'run-1',
      'passed',
      'artifact validated'
    )

    expect(first.workflowReceipt).toMatchObject({
      outcome: 'passed',
      summary: 'artifact validated',
      source: 'agent'
    })
    expect(second).toBe(first)
    expect(flush).toHaveBeenCalledTimes(1)
    expect(() =>
      recordAutomationWorkflowReceipt(operations, 'run-1', 'failed', 'different')
    ).toThrow('already recorded')
  })
})

describe('recordAutomationSemanticEvaluation', () => {
  it('is immutable and idempotent for the same structured result', () => {
    const state = stateWithRuns([{ id: 'run-1', createdAt: 1 }])
    state.automationRuns[0].semanticEvaluation = {
      evaluator: 'jev',
      mode: 'shadow',
      rubricPath: 'rubric.json'
    }
    const flush = vi.fn()
    const operations = {
      state,
      flush,
      recordManualRun: vi.fn(),
      getWorkspaceDisplayName: () => null
    }
    const result = {
      evaluator: 'jev' as const,
      mode: 'shadow' as const,
      model: 'typesafe-ai/jev',
      rubricId: 'memory-review',
      rubricVersion: '1',
      rubricSha256: 'a'.repeat(64),
      stateSha256: 'b'.repeat(64),
      choice: 'requirements_satisfied' as const,
      probabilities: {
        requirements_satisfied: 0.9,
        requirements_not_satisfied: 0.03,
        insufficient_evidence: 0.07
      },
      confidence: 0.9,
      minimumConfidence: 0.8,
      evidenceRefs: ['artifact:1']
    }

    const first = recordAutomationSemanticEvaluation(operations, 'run-1', result)
    const second = recordAutomationSemanticEvaluation(operations, 'run-1', result)

    expect(first.semanticEvaluationReceipt).toMatchObject({ ...result, source: 'evaluator' })
    expect(second).toBe(first)
    expect(flush).toHaveBeenCalledTimes(1)
    expect(() =>
      recordAutomationSemanticEvaluation(operations, 'run-1', {
        ...result,
        choice: 'requirements_not_satisfied'
      })
    ).toThrow('already recorded')
  })

  it('treats a reordered persisted receipt as the same structured result', () => {
    const state = stateWithRuns([{ id: 'run-1', createdAt: 1 }])
    state.automationRuns[0].semanticEvaluation = {
      evaluator: 'jev',
      mode: 'shadow',
      rubricPath: 'rubric.json'
    }
    state.automationRuns[0].semanticEvaluationReceipt = {
      source: 'evaluator',
      recordedAt: 2,
      evidenceRefs: ['artifact:1'],
      minimumConfidence: 0.8,
      confidence: 0.9,
      probabilities: {
        insufficient_evidence: 0.07,
        requirements_not_satisfied: 0.03,
        requirements_satisfied: 0.9
      },
      choice: 'requirements_satisfied',
      stateSha256: 'b'.repeat(64),
      rubricSha256: 'a'.repeat(64),
      rubricVersion: '1',
      rubricId: 'memory-review',
      model: 'typesafe-ai/jev',
      mode: 'shadow',
      evaluator: 'jev'
    }
    const flush = vi.fn()
    const operations = {
      state,
      flush,
      recordManualRun: vi.fn(),
      getWorkspaceDisplayName: () => null
    }

    const retried = recordAutomationSemanticEvaluation(operations, 'run-1', {
      evaluator: 'jev',
      mode: 'shadow',
      model: 'typesafe-ai/jev',
      rubricId: 'memory-review',
      rubricVersion: '1',
      rubricSha256: 'a'.repeat(64),
      stateSha256: 'b'.repeat(64),
      choice: 'requirements_satisfied',
      probabilities: {
        requirements_satisfied: 0.9,
        requirements_not_satisfied: 0.03,
        insufficient_evidence: 0.07
      },
      confidence: 0.9,
      minimumConfidence: 0.8,
      evidenceRefs: ['artifact:1']
    })

    expect(retried).toBe(state.automationRuns[0])
    expect(flush).not.toHaveBeenCalled()
  })

  it('does not apply a newly enabled Jev contract to an explicit process-only run', () => {
    const state = stateWithRuns([{ id: 'run-1', createdAt: 1 }])
    state.automationRuns[0].semanticEvaluation = null
    state.automations = [
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: receipt lookup only reads these automation fields.
      {
        id: 'a1',
        semanticEvaluation: {
          evaluator: 'jev',
          mode: 'enforced',
          rubricPath: 'rubric.json'
        }
      } as PersistedState['automations'][number]
    ]
    const operations = {
      state,
      flush: vi.fn(),
      recordManualRun: vi.fn(),
      getWorkspaceDisplayName: () => null
    }

    expect(() =>
      recordAutomationSemanticEvaluation(operations, 'run-1', {
        evaluator: 'jev',
        mode: 'enforced',
        model: 'typesafe-ai/jev',
        rubricId: 'memory-review',
        rubricVersion: '1',
        rubricSha256: 'a'.repeat(64),
        stateSha256: 'b'.repeat(64),
        choice: 'requirements_satisfied',
        probabilities: {
          requirements_satisfied: 0.9,
          requirements_not_satisfied: 0.03,
          insufficient_evidence: 0.07
        },
        confidence: 0.9,
        minimumConfidence: 0.8,
        evidenceRefs: []
      })
    ).toThrow('no matching semantic evaluation configuration')
  })

  it('refuses a result that does not match the run evaluation mode', () => {
    const state = stateWithRuns([{ id: 'run-1', createdAt: 1 }])
    state.automationRuns[0].semanticEvaluation = {
      evaluator: 'jev',
      mode: 'enforced',
      rubricPath: 'rubric.json'
    }
    const operations = {
      state,
      flush: vi.fn(),
      recordManualRun: vi.fn(),
      getWorkspaceDisplayName: () => null
    }

    expect(() =>
      recordAutomationSemanticEvaluation(operations, 'run-1', {
        evaluator: 'jev',
        mode: 'shadow',
        model: 'typesafe-ai/jev',
        rubricId: 'memory-review',
        rubricVersion: '1',
        rubricSha256: 'a'.repeat(64),
        stateSha256: 'b'.repeat(64),
        choice: 'requirements_satisfied',
        probabilities: {
          requirements_satisfied: 0.9,
          requirements_not_satisfied: 0.03,
          insufficient_evidence: 0.07
        },
        confidence: 0.9,
        minimumConfidence: 0.8,
        evidenceRefs: []
      })
    ).toThrow('mode does not match')
  })
})
