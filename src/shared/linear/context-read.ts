import { z } from 'zod'
import { LINEAR_UUID_PATTERN } from './uuid'

const identity = z.object({ id: z.string().regex(LINEAR_UUID_PATTERN) })
const issueIdentity = identity.extend({ identifier: z.string().min(1), url: z.string().url() })

export const LinearParentIdentity = issueIdentity.extend({
  team: identity.extend({ key: z.string().min(1) })
})
export type LinearParent = z.infer<typeof LinearParentIdentity>

export const LinearDocumentContent = identity.extend({
  slugId: z.string().min(1),
  title: z.string(),
  url: z.string().url(),
  content: z.string().nullable(),
  updatedAt: z.string().min(1),
  project: identity.nullable(),
  issue: issueIdentity.nullable()
})
export type LinearDocumentRead = z.infer<typeof LinearDocumentContent> & { workspaceId: string }

export const LinearProjectContent = identity.extend({
  name: z.string(),
  url: z.string().url(),
  description: z.string().nullable(),
  content: z.string().nullable(),
  updatedAt: z.string().min(1)
})

export type LinearContentReadMeta = {
  resolved: { id: string; workspaceId: string }
  partial: boolean
  includeErrors: { include: 'documents'; code: 'linear_partial'; message: string }[]
}

export type LinearProjectReadResult = {
  project: z.infer<typeof LinearProjectContent> & { workspaceId: string }
  documents: LinearDocumentRead[]
  meta: LinearContentReadMeta & {
    sections: {
      documents?: {
        returned: number
        cap: number
        capReached: boolean
        hasMore: boolean
        nextCursor: string | null
      }
    }
  }
}

export type LinearDocumentReadResult = {
  document: LinearDocumentRead
  meta: LinearContentReadMeta & { contentComplete: boolean }
}

export type LinearContentReadRequest = { id: string; workspaceId: string }
export type LinearProjectReadRequest = LinearContentReadRequest & { full: boolean }
