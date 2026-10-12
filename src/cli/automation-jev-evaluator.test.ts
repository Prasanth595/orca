import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { evaluateAutomationEvidenceWithJev } from './automation-jev-evaluator'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  )
})

async function fixture(): Promise<{ cwd: string; rubricPath: string; stateFile: string }> {
  const cwd = await mkdtemp(join(tmpdir(), 'orca-jev-'))
  temporaryDirectories.push(cwd)
  const rubricPath = 'rubric.json'
  const stateFile = 'state.json'
  await writeFile(
    join(cwd, rubricPath),
    JSON.stringify({
      id: 'customer-memory-review',
      version: '1',
      instructions: 'Judge the supplied evidence.',
      criteria: {
        requirements_satisfied: 'Every requirement is supported.',
        requirements_not_satisfied: 'At least one requirement failed.',
        insufficient_evidence: 'The evidence cannot establish either result.'
      },
      minimumConfidence: 0.8
    })
  )
  await writeFile(
    join(cwd, stateFile),
    JSON.stringify({
      evidenceRefs: ['artifact:report-1'],
      checks: [{ id: 'coverage', passed: true }]
    })
  )
  return { cwd, rubricPath, stateFile }
}

describe('Jev automation evidence evaluation', () => {
  it('sends the bounded question shape and returns a hash-backed receipt', async () => {
    const files = await fixture()
    const fetchImpl = vi.fn(async (_url: string, init: { body: string }) => {
      const request = JSON.parse(init.body)
      expect(request).toMatchObject({
        model: 'typesafe-ai/jev',
        state: { evidenceRefs: ['artifact:report-1'] },
        questions: {
          automation_result: {
            type: 'choice',
            criteria: {
              requirements_satisfied: 'Every requirement is supported.',
              requirements_not_satisfied: 'At least one requirement failed.',
              insufficient_evidence: 'The evidence cannot establish either result.'
            }
          }
        }
      })
      return {
        ok: true,
        status: 200,
        json: async () => ({
          answers: {
            automation_result: {
              choice: 'requirements_satisfied',
              probabilities: {
                requirements_satisfied: 0.91,
                requirements_not_satisfied: 0.03,
                insufficient_evidence: 0.06
              }
            }
          },
          providerMetadata: {
            typesafe: {
              confidence: { automation_result: 0.91 }
            }
          }
        })
      }
    })

    const result = await evaluateAutomationEvidenceWithJev({
      ...files,
      mode: 'shadow',
      apiKey: 'test-only',
      fetchImpl
    })

    expect(result).toMatchObject({
      evaluator: 'jev',
      mode: 'shadow',
      model: 'typesafe-ai/jev',
      rubricId: 'customer-memory-review',
      rubricVersion: '1',
      choice: 'requirements_satisfied',
      confidence: 0.91,
      minimumConfidence: 0.8,
      evidenceRefs: ['artifact:report-1']
    })
    expect(result.rubricSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(result.stateSha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it('rejects a rubric without the fixed insufficient-evidence outcome', async () => {
    const files = await fixture()
    await writeFile(
      join(files.cwd, files.rubricPath),
      JSON.stringify({
        id: 'bad',
        version: '1',
        instructions: 'Judge.',
        criteria: {
          requirements_satisfied: 'yes',
          requirements_not_satisfied: 'no'
        },
        minimumConfidence: 0.8
      })
    )

    await expect(
      evaluateAutomationEvidenceWithJev({
        ...files,
        mode: 'enforced',
        apiKey: 'test-only',
        fetchImpl: vi.fn()
      })
    ).rejects.toThrow('insufficient_evidence')
  })
})
