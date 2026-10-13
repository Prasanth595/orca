import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import type {
  AutomationSemanticEvaluationChoice,
  AutomationSemanticEvaluationMode,
  AutomationSemanticEvaluationResult
} from '../shared/automations-types'
import { RuntimeClientError } from './runtime-client'

const JEV_GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/evaluate'
const JEV_MODEL = 'typesafe-ai/jev'
const QUESTION_ID = 'automation_result'
type JevRubric = {
  id: string
  version: string
  instructions: string
  criteria: Record<AutomationSemanticEvaluationChoice, string>
  minimumConfidence: number
}

type JevFetch = (
  url: string,
  init: {
    method: 'POST'
    headers: Record<string, string>
    body: string
    signal: AbortSignal
  }
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

function invalid(message: string): never {
  throw new RuntimeClientError('invalid_argument', message)
}

function objectValue(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    invalid(message)
  }
  return Object.fromEntries(Object.entries(value))
}

function nonEmptyString(value: unknown, message: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    invalid(message)
  }
  return value.trim()
}

function probability(value: unknown, message: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    invalid(message)
  }
  return value
}

function parseRubric(value: unknown): JevRubric {
  const rubric = objectValue(value, 'Jev rubric must be a JSON object.')
  const criteriaInput = objectValue(rubric.criteria, 'Jev rubric criteria must be a JSON object.')
  const criteria = {
    requirements_satisfied: nonEmptyString(
      criteriaInput.requirements_satisfied,
      'Jev rubric is missing criterion: requirements_satisfied'
    ),
    requirements_not_satisfied: nonEmptyString(
      criteriaInput.requirements_not_satisfied,
      'Jev rubric is missing criterion: requirements_not_satisfied'
    ),
    insufficient_evidence: nonEmptyString(
      criteriaInput.insufficient_evidence,
      'Jev rubric is missing criterion: insufficient_evidence'
    )
  }
  const minimumConfidence = probability(
    rubric.minimumConfidence,
    'Jev rubric minimumConfidence must be between 0 and 1.'
  )
  return {
    id: nonEmptyString(rubric.id, 'Jev rubric is missing id.'),
    version: nonEmptyString(rubric.version, 'Jev rubric is missing version.'),
    instructions: nonEmptyString(rubric.instructions, 'Jev rubric is missing instructions.'),
    criteria,
    minimumConfidence
  }
}

function parseState(value: unknown): {
  state: Record<string, unknown>
  evidenceRefs: string[]
} {
  const state = objectValue(value, 'Jev state must be a JSON object.')
  const rawRefs = state.evidenceRefs
  if (rawRefs === undefined) {
    return { state, evidenceRefs: [] }
  }
  if (
    !Array.isArray(rawRefs) ||
    rawRefs.length > 100 ||
    rawRefs.some((entry) => typeof entry !== 'string' || !entry.trim())
  ) {
    invalid('Jev state evidenceRefs must be an array of at most 100 non-empty strings.')
  }
  return { state, evidenceRefs: rawRefs.map((entry) => entry.trim()) }
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

async function readJson(path: string, label: string): Promise<{ raw: string; value: unknown }> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    invalid(`Unable to read ${label}: ${path}`)
  }
  try {
    return { raw, value: JSON.parse(raw) }
  } catch {
    invalid(`${label} must contain valid JSON: ${path}`)
  }
}

function parseAnswer(value: unknown): {
  choice: AutomationSemanticEvaluationChoice
  probabilities: Record<AutomationSemanticEvaluationChoice, number>
  confidence: number
} {
  const response = objectValue(value, 'Jev returned an invalid response.')
  const answers = objectValue(response.answers, 'Jev response is missing answers.')
  const answer = objectValue(answers[QUESTION_ID], 'Jev response is missing automation_result.')
  const choice = nonEmptyString(answer.choice, 'Jev response is missing a choice.')
  if (
    choice !== 'requirements_satisfied' &&
    choice !== 'requirements_not_satisfied' &&
    choice !== 'insufficient_evidence'
  ) {
    invalid(`Jev returned an unsupported choice: ${choice}`)
  }
  const rawProbabilities = objectValue(
    answer.probabilities,
    'Jev response is missing probabilities.'
  )
  const providerMetadata = objectValue(
    response.providerMetadata,
    'Jev response is missing provider metadata.'
  )
  const typesafeMetadata = objectValue(
    providerMetadata.typesafe,
    'Jev response is missing TypeSafe provider metadata.'
  )
  const confidenceByQuestion = objectValue(
    typesafeMetadata.confidence,
    'Jev response is missing confidence metadata.'
  )
  const probabilities = {
    requirements_satisfied: probability(
      rawProbabilities.requirements_satisfied,
      'Jev response is missing probability: requirements_satisfied'
    ),
    requirements_not_satisfied: probability(
      rawProbabilities.requirements_not_satisfied,
      'Jev response is missing probability: requirements_not_satisfied'
    ),
    insufficient_evidence: probability(
      rawProbabilities.insufficient_evidence,
      'Jev response is missing probability: insufficient_evidence'
    )
  }
  return {
    choice,
    probabilities,
    confidence: probability(
      confidenceByQuestion[QUESTION_ID],
      'Jev response confidence must be between 0 and 1.'
    )
  }
}

async function requestJev(
  apiKey: string,
  payload: Record<string, unknown>,
  fetchImpl: JevFetch
): Promise<unknown> {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 120_000)
    try {
      const response = await fetchImpl(JEV_GATEWAY_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      })
      if (response.ok) {
        return await response.json()
      }
      if (response.status < 500 || attempt === 2) {
        throw new RuntimeClientError(
          'runtime_error',
          `Jev evaluation failed with HTTP ${response.status}.`
        )
      }
      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) {
      if (error instanceof RuntimeClientError || attempt === 2) {
        throw error
      }
      lastError = error
    } finally {
      clearTimeout(timeout)
    }
    await new Promise((done) => setTimeout(done, 250 * 2 ** attempt))
  }
  throw lastError
}

export async function evaluateAutomationEvidenceWithJev(input: {
  cwd: string
  stateFile: string
  rubricPath: string
  mode: AutomationSemanticEvaluationMode
  apiKey: string
  fetchImpl?: JevFetch
}): Promise<AutomationSemanticEvaluationResult> {
  const statePath = isAbsolute(input.stateFile)
    ? input.stateFile
    : resolve(input.cwd, input.stateFile)
  const rubricPath = isAbsolute(input.rubricPath)
    ? input.rubricPath
    : resolve(input.cwd, input.rubricPath)
  const [stateFile, rubricFile] = await Promise.all([
    readJson(statePath, 'Jev state file'),
    readJson(rubricPath, 'Jev rubric file')
  ])
  const rubric = parseRubric(rubricFile.value)
  const { state, evidenceRefs } = parseState(stateFile.value)
  const fetchImpl: JevFetch = input.fetchImpl ?? ((url, init) => fetch(url, init))
  const answer = parseAnswer(
    await requestJev(
      input.apiKey,
      {
        model: JEV_MODEL,
        state,
        questions: {
          [QUESTION_ID]: {
            type: 'choice',
            instructions: rubric.instructions,
            criteria: rubric.criteria
          }
        }
      },
      fetchImpl
    )
  )
  return {
    evaluator: 'jev',
    mode: input.mode,
    model: JEV_MODEL,
    rubricId: rubric.id,
    rubricVersion: rubric.version,
    rubricSha256: sha256(rubricFile.raw),
    stateSha256: sha256(stateFile.raw),
    choice: answer.choice,
    probabilities: answer.probabilities,
    confidence: answer.confidence,
    minimumConfidence: rubric.minimumConfidence,
    evidenceRefs
  }
}
