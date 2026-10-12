import { afterEach, describe, expect, it, vi } from 'vitest'
import { AUTOMATION_SEMANTIC_EVALUATION_RUNTIME_CAPABILITY } from '../../shared/protocol-version'
import { RuntimeClientError } from '../runtime-client'

const { evaluateAutomationEvidenceWithJev } = vi.hoisted(() => ({
  evaluateAutomationEvidenceWithJev: vi.fn()
}))

vi.mock('../automation-jev-evaluator', () => ({ evaluateAutomationEvidenceWithJev }))

import { AUTOMATION_HANDLERS } from './automations'

function ok(result: unknown): unknown {
  return { id: 'request-1', ok: true, result, _meta: { runtimeId: 'runtime-1' } }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  evaluateAutomationEvidenceWithJev.mockReset()
})

describe('CLI automation run history', () => {
  it('forwards bounded filters using an absolute timestamp', async () => {
    const call = vi.fn(async () => ok({ runs: [], nextCursor: null }))
    vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await AUTOMATION_HANDLERS['automations runs']!({
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler uses only the mocked call method.
      client: { call } as never,
      cwd: '/tmp',
      flags: new Map([
        ['id', 'auto-1'],
        ['limit', '25'],
        ['cursor', 'cursor-1'],
        ['status', 'dispatch_failed'],
        ['since', '2026-10-01T00:00:00-04:00']
      ]),
      json: true
    })

    expect(call).toHaveBeenCalledWith('automation.runs', {
      automationId: 'auto-1',
      limit: 25,
      cursor: 'cursor-1',
      status: 'dispatch_failed',
      since: Date.parse('2026-10-01T00:00:00-04:00')
    })
  })

  it('rejects a timestamp without an explicit offset', async () => {
    await expect(
      AUTOMATION_HANDLERS['automations runs']!({
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: validation fails before the client is called.
        client: { call: vi.fn() } as never,
        cwd: '/tmp',
        flags: new Map([['since', '2026-10-01']]),
        json: true
      })
    ).rejects.toBeInstanceOf(RuntimeClientError)
  })

  it('looks up one exact run id', async () => {
    const call = vi.fn(async () => ok({ run: { id: 'run-1' } }))
    vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await AUTOMATION_HANDLERS['automations run-show']!({
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler uses only the mocked call method.
      client: { call } as never,
      cwd: '/tmp',
      flags: new Map([['id', 'run-1']]),
      json: true
    })

    expect(call).toHaveBeenCalledWith('automation.runShow', { id: 'run-1' })
  })

  it('records a workflow receipt for one exact run', async () => {
    const call = vi.fn(async () => ok({ run: { id: 'run-1' } }))
    vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await AUTOMATION_HANDLERS['automations receipt']!({
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler uses only the mocked call method.
      client: { call } as never,
      cwd: '/tmp',
      flags: new Map([
        ['run', 'run-1'],
        ['outcome', 'passed'],
        ['summary', 'artifact validated']
      ]),
      json: true
    })

    expect(call).toHaveBeenCalledWith('automation.recordWorkflowReceipt', {
      runId: 'run-1',
      outcome: 'passed',
      summary: 'artifact validated'
    })
  })

  it('evaluates against the immutable run contract and records the result', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', 'test-only')
    const semanticResult = {
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
        requirements_not_satisfied: 0.05,
        insufficient_evidence: 0.05
      },
      confidence: 0.9,
      minimumConfidence: 0.8,
      evidenceRefs: ['artifact:1']
    }
    evaluateAutomationEvidenceWithJev.mockResolvedValue(semanticResult)
    const call = vi.fn(async (method: string) => {
      if (method === 'status.get') {
        return ok({ capabilities: [AUTOMATION_SEMANTIC_EVALUATION_RUNTIME_CAPABILITY] })
      }
      if (method === 'automation.runShow') {
        return ok({
          run: {
            id: 'run-1',
            automationId: 'auto-1',
            semanticEvaluation: {
              evaluator: 'jev',
              mode: 'shadow',
              rubricPath: 'rubrics/v1.json'
            }
          }
        })
      }
      if (method === 'automation.show') {
        return ok({
          automation: {
            id: 'auto-1',
            semanticEvaluation: {
              evaluator: 'jev',
              mode: 'enforced',
              rubricPath: 'rubrics/v2.json'
            }
          }
        })
      }
      return ok({ run: { id: 'run-1', semanticEvaluationReceipt: semanticResult } })
    })
    vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await AUTOMATION_HANDLERS['automations jev-evaluate']!({
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler uses only the mocked call method.
      client: { call } as never,
      cwd: '/workspace',
      flags: new Map([
        ['run', 'run-1'],
        ['state-file', 'state.json']
      ]),
      json: true
    })

    expect(evaluateAutomationEvidenceWithJev).toHaveBeenCalledWith({
      cwd: '/workspace',
      stateFile: 'state.json',
      rubricPath: 'rubrics/v1.json',
      mode: 'shadow',
      apiKey: 'test-only'
    })
    expect(call).toHaveBeenLastCalledWith('automation.recordSemanticEvaluation', {
      runId: 'run-1',
      result: semanticResult
    })
  })

  it('refuses Jev evaluation before reading state or calling an older host', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', 'test-only')
    const call = vi.fn(async () => ok({ capabilities: [] }))

    await expect(
      AUTOMATION_HANDLERS['automations jev-evaluate']!({
        client: { call } as never,
        cwd: '/workspace',
        flags: new Map([
          ['run', 'run-1'],
          ['state-file', 'state.json']
        ]),
        json: true
      })
    ).rejects.toMatchObject({
      code: 'incompatible_runtime',
      message:
        'Jev automation evaluation requires a newer Orca server. Update the HUB and try again.'
    })

    expect(call).toHaveBeenCalledTimes(1)
    expect(call).toHaveBeenCalledWith('status.get')
    expect(evaluateAutomationEvidenceWithJev).not.toHaveBeenCalled()
  })
})

describe('CLI automation doctor', () => {
  it('keeps the fleet report and marks an unreadable history unverifiable', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(100)
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const call = vi.fn(async (method: string, params?: { automationId?: string }) => {
      if (method === 'automation.list') {
        return ok({
          automations: [
            { id: 'healthy', name: 'Healthy', enabled: true, nextRunAt: 200 },
            { id: 'offline', name: 'Offline', enabled: true, nextRunAt: 200 }
          ]
        })
      }
      if (params?.automationId === 'offline') {
        throw new Error('host unavailable')
      }
      return ok({ runs: [], nextCursor: null })
    })

    await AUTOMATION_HANDLERS['automations doctor']!({
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler uses only the mocked call method.
      client: { call } as never,
      cwd: '/tmp',
      flags: new Map(),
      json: true
    })

    const output = String(log.mock.calls[0]?.[0])
    expect(output).toContain('"verdict": "healthy"')
    expect(output).toContain('"verdict": "unverifiable"')
    expect(output).not.toContain('host unavailable')
  })
})
