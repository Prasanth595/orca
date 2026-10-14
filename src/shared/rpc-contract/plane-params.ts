import { z } from 'zod'
import {
  isPlaneCursor,
  isPlaneUuid,
  normalizePlaneWorkspaceSlug,
  parsePlaneWorkItemIdentifier
} from '../plane-ids'
import { OptionalBoolean, requiredString } from './rpc-param-primitives'

export const PLANE_COMMENT_MAX_LENGTH = 10_000
const PLANE_API_TOKEN_MAX_LENGTH = 512
const PLANE_URL_MAX_LENGTH = 2048
// Why a cap: "all projects" lists resolve on the host; a selection this large is not a choice.
const PLANE_SELECTED_PROJECTS_MAX = 500

const PlaneUuid = z
  .string()
  .refine(isPlaneUuid, 'Invalid Plane id')
  .transform((value) => value.toLowerCase())

const PlaneUrlField = z
  .string()
  .max(PLANE_URL_MAX_LENGTH, 'URL is too long')
  .transform((value) => value.trim())

const PlaneWorkspaceSlug = z.unknown().transform((value, ctx) => {
  const slug = normalizePlaneWorkspaceSlug(value)
  if (!slug) {
    ctx.addIssue({ code: 'custom', message: 'Invalid Plane workspace slug' })
    return z.NEVER
  }
  return slug
})

export const Connect = z
  .object({
    hostKind: z.enum(['cloud', 'self-hosted']),
    serverUrl: PlaneUrlField.optional(),
    apiBaseUrl: PlaneUrlField.optional(),
    workspaceSlug: PlaneWorkspaceSlug,
    apiToken: requiredString('API token is required')
      .transform((value) => value.trim())
      .pipe(
        z
          .string()
          .min(1, 'API token is required')
          .max(PLANE_API_TOKEN_MAX_LENGTH, 'API token is too long')
          .regex(/^\S+$/, 'API token cannot contain spaces')
      ),
    insecureHttpAcknowledged: OptionalBoolean
  })
  .superRefine((value, ctx) => {
    if (value.hostKind === 'self-hosted' && !value.serverUrl) {
      ctx.addIssue({ code: 'custom', path: ['serverUrl'], message: 'Server URL is required' })
    }
  })

export const PlaneProjectScopeParam = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('all') }),
  z.object({
    mode: z.literal('selected'),
    projectIds: z
      .array(PlaneUuid)
      .min(1, 'Choose at least one project')
      .max(PLANE_SELECTED_PROJECTS_MAX)
      .refine((ids) => new Set(ids).size === ids.length, 'Duplicate project ids')
  })
])

export const SetProjectScope = z.object({ scope: PlaneProjectScopeParam })

export const ListWorkItems = z
  .object({
    projectIds: z.array(PlaneUuid).max(PLANE_SELECTED_PROJECTS_MAX).optional(),
    cursorByProject: z
      .record(PlaneUuid, z.string().refine(isPlaneCursor, 'Invalid Plane cursor'))
      .optional(),
    refresh: OptionalBoolean
  })
  .optional()

export const WorkItemRef = z.object({
  projectId: PlaneUuid,
  workItemId: PlaneUuid
})

export const UpdateState = WorkItemRef.extend({ stateId: PlaneUuid })

export const AddComment = WorkItemRef.extend({
  text: z
    .string()
    .transform((value) => value.trim())
    .pipe(
      z
        .string()
        .min(1, 'Comment cannot be empty')
        .max(PLANE_COMMENT_MAX_LENGTH, 'Comment is too long')
    )
})

export const ProjectRef = z.object({ projectId: PlaneUuid })

export const LookupIdentifier = z.object({
  identifier: z.unknown().transform((value, ctx) => {
    const parsed = parsePlaneWorkItemIdentifier(value)
    if (!parsed) {
      ctx.addIssue({ code: 'custom', message: 'Invalid Plane work item identifier' })
      return z.NEVER
    }
    return parsed.identifier
  })
})

export type PlaneConnectParams = z.infer<typeof Connect>
export type PlaneSetProjectScopeParams = z.infer<typeof SetProjectScope>
export type PlaneListWorkItemsParams = z.infer<typeof ListWorkItems>
export type PlaneWorkItemRefParams = z.infer<typeof WorkItemRef>
export type PlaneUpdateStateParams = z.infer<typeof UpdateState>
export type PlaneAddCommentParams = z.infer<typeof AddComment>
export type PlaneLookupIdentifierParams = z.infer<typeof LookupIdentifier>
