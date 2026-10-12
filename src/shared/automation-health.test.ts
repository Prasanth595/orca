import { describe, expect, it } from 'vitest'
import type { Automation, AutomationRun } from './automations-types'
import { deriveAutomationHealth } from './automation-health'

function automation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: 'auto-1',
    name: 'Nightly',
    prompt: 'Run checks',
    precheck: null,
    agentId: 'codex',
    projectId: 'repo-1',
    executionTargetType: 'local',
    executionTargetId: 'local',
    schedulerOwner: 'local_host_service',
    workspaceMode: 'new_per_run',
    workspaceId: null,
    baseBranch: null,
    reuseSession: false,
    timezone: 'America/New_York',
    rrule: 'FREQ=DAILY;BYHOUR=9;BYMINUTE=0',
    dtstart: 1,
    enabled: true,
    nextRunAt: 200,
    missedRunPolicy: 'run_once_within_grace',
    missedRunGraceMinutes: 720,
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  }
}

function run(id: string, status: AutomationRun['status']): AutomationRun {
  return {
    id,
    automationId: 'auto-1',
    title: id,
    scheduledFor: 1,
    status,
    trigger: 'scheduled',
    workspaceId: null,
    sessionKind: 'terminal',
    chatSessionId: null,
    terminalSessionId: null,
    terminalPaneKey: null,
    terminalPtyId: null,
    outputSnapshot: null,
    precheckResult: null,
    usage: null,
    error: null,
    startedAt: 1,
    dispatchedAt: 1,
    createdAt: 1
  }
}

describe('deriveAutomationHealth', () => {
  it('reports a failed latest run and counts the consecutive failure streak', () => {
    const result = deriveAutomationHealth({
      automation: automation(),
      runs: [
        run('third', 'dispatch_failed'),
        run('second', 'skipped_precheck'),
        run('first', 'completed')
      ],
      now: 100
    })

    expect(result).toMatchObject({ verdict: 'failed', consecutiveFailures: 2, lastRunId: 'third' })
  })

  it('reports enabled schedules whose next dispatch is overdue', () => {
    expect(
      deriveAutomationHealth({ automation: automation({ nextRunAt: 50 }), runs: [], now: 100 })
    ).toMatchObject({ verdict: 'overdue', overdueDurationMs: 50 })
  })

  it('does not call a disabled schedule overdue', () => {
    expect(
      deriveAutomationHealth({
        automation: automation({ enabled: false, nextRunAt: 50 }),
        runs: [],
        now: 100
      })
    ).toMatchObject({ verdict: 'disabled', overdueDurationMs: 0 })
  })

  it('fails closed when owner history cannot be verified', () => {
    expect(
      deriveAutomationHealth({
        automation: automation(),
        runs: [],
        now: 100,
        historyAvailable: false
      })
    ).toMatchObject({ verdict: 'unverifiable', historyAvailable: false })
  })

  it('requires a semantic receipt only for schedules that opted in', () => {
    const latest = run('latest', 'completed')
    expect(
      deriveAutomationHealth({
        automation: automation({ workflowReceiptRequired: true }),
        runs: [latest],
        now: 100
      })
    ).toMatchObject({ verdict: 'unverifiable', lastWorkflowOutcome: null })

    expect(
      deriveAutomationHealth({ automation: automation(), runs: [latest], now: 100 })
    ).toMatchObject({ verdict: 'healthy' })
  })

  it('surfaces a blocked workflow receipt as failed', () => {
    expect(
      deriveAutomationHealth({
        automation: automation({ workflowReceiptRequired: true }),
        runs: [
          {
            ...run('latest', 'completed'),
            workflowReceipt: {
              outcome: 'blocked',
              summary: 'Missing access',
              recordedAt: 2,
              source: 'agent'
            }
          }
        ],
        now: 100
      })
    ).toMatchObject({ verdict: 'failed', lastWorkflowOutcome: 'blocked' })
  })

  it('records shadow Jev results without changing health', () => {
    expect(
      deriveAutomationHealth({
        automation: automation({
          semanticEvaluation: { evaluator: 'jev', mode: 'shadow', rubricPath: 'rubric.json' }
        }),
        runs: [
          {
            ...run('latest', 'completed'),
            semanticEvaluationReceipt: semanticReceipt('requirements_not_satisfied', 0.95)
          }
        ],
        now: 100
      })
    ).toMatchObject({
      verdict: 'healthy',
      semanticEvaluationMode: 'shadow',
      lastSemanticChoice: 'requirements_not_satisfied'
    })
  })

  it('enforces Jev failures and treats weak evidence as unverifiable', () => {
    const configured = automation({
      semanticEvaluation: { evaluator: 'jev', mode: 'enforced', rubricPath: 'rubric.json' }
    })
    expect(
      deriveAutomationHealth({
        automation: configured,
        runs: [run('missing', 'completed')],
        now: 100
      })
    ).toMatchObject({ verdict: 'unverifiable' })
    expect(
      deriveAutomationHealth({
        automation: configured,
        runs: [
          {
            ...run('wrong-mode', 'completed'),
            semanticEvaluation: configured.semanticEvaluation,
            semanticEvaluationReceipt: semanticReceipt('requirements_satisfied', 0.95, 'shadow')
          }
        ],
        now: 100
      })
    ).toMatchObject({ verdict: 'unverifiable' })
    expect(
      deriveAutomationHealth({
        automation: configured,
        runs: [
          {
            ...run('failed', 'completed'),
            semanticEvaluationReceipt: semanticReceipt('requirements_not_satisfied', 0.95)
          }
        ],
        now: 100
      })
    ).toMatchObject({ verdict: 'failed' })
    expect(
      deriveAutomationHealth({
        automation: configured,
        runs: [
          {
            ...run('weak', 'completed'),
            semanticEvaluationReceipt: semanticReceipt('requirements_satisfied', 0.7)
          }
        ],
        now: 100
      })
    ).toMatchObject({ verdict: 'unverifiable' })
  })
})

function semanticReceipt(
  choice: 'requirements_satisfied' | 'requirements_not_satisfied' | 'insufficient_evidence',
  confidence: number,
  mode: 'shadow' | 'enforced' = 'enforced'
): NonNullable<AutomationRun['semanticEvaluationReceipt']> {
  return {
    evaluator: 'jev',
    mode,
    model: 'typesafe-ai/jev',
    rubricId: 'test',
    rubricVersion: '1',
    rubricSha256: 'a'.repeat(64),
    stateSha256: 'b'.repeat(64),
    choice,
    probabilities: {
      requirements_satisfied: choice === 'requirements_satisfied' ? confidence : 0,
      requirements_not_satisfied: choice === 'requirements_not_satisfied' ? confidence : 0,
      insufficient_evidence: choice === 'insufficient_evidence' ? confidence : 0
    },
    confidence,
    minimumConfidence: 0.8,
    evidenceRefs: [],
    recordedAt: 2,
    source: 'evaluator'
  }
}
