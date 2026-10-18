import { z } from 'zod'
import { OptionalString, requiredString } from './rpc-param-primitives'

export const WorkflowsShow = z.object({
  id: requiredString('Missing workflow id')
})

export const WorkflowsRun = z.object({
  id: requiredString('Missing workflow id')
})

export const WorkflowsDelete = z.object({
  id: requiredString('Missing workflow id')
})

export const WorkflowsRuns = z.object({
  workflowId: OptionalString,
  limit: z.number().int().positive().max(200).optional()
})

/** Cloud-agnostic import: the version-1 export file as a JSON string, parsed by Zod. */
export const WorkflowsImport = z.object({
  json: requiredString('Missing workflow JSON'),
  /** Required when the export targets SSH; ignored (normalized to "local") otherwise. */
  executionTargetId: OptionalString
})
