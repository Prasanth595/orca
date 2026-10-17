import { z } from 'zod'
import {
  LinearDocumentContent,
  LinearProjectContent,
  type LinearContentReadRequest,
  type LinearDocumentReadResult,
  type LinearProjectReadRequest,
  type LinearProjectReadResult
} from '../../shared/linear/context-read'
import { isLinearUuid } from '../../shared/linear/uuid'
import { withTimeout } from '../../shared/promise-timeout-fallback'
import { getRequiredEntry, withLinearRead } from './issue-context-client'
import { linearError } from './issue-context-errors'
import { DOCUMENT_CONTENT_QUERY, PROJECT_CONTENT_QUERY } from './linear-content-queries'

const DOCUMENT_CAP = 20
const PAGE_SIZE = 10
const CONTENT_BYTES_CAP = 2 * 1024 * 1024
const READ_TIMEOUT_MS = 30_000
const connection = z.object({
  nodes: z.array(LinearDocumentContent),
  pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() })
})
const projectPage = LinearProjectContent.extend({ documents: connection.optional() })
const envelope = z.object({ data: z.unknown(), errors: z.array(z.unknown()).optional() })

async function readContent(
  request: LinearContentReadRequest,
  query: string,
  variables: { id: string; full?: boolean; first?: number; after?: string },
  deadline = Date.now() + READ_TIMEOUT_MS
): Promise<unknown> {
  if (!isLinearUuid(request.workspaceId)) {
    throw linearError('linear_invalid_workspace', 'Pass a concrete Linear workspace UUID.')
  }
  const entry = getRequiredEntry(request.workspaceId)
  if (entry.workspace.id !== request.workspaceId) {
    throw linearError('linear_invalid_workspace', 'Resolved Linear workspace does not match.')
  }
  // Keep the existing concurrency permit until the underlying read actually settles.
  const controller = new AbortController()
  const read = withLinearRead(
    entry,
    () => entry.client.client.rawRequest(query, variables),
    undefined,
    controller.signal
  )
  const outcome = await withTimeout(
    read.then(
      (value) => ({ kind: 'value' as const, value }),
      (error: unknown) => ({ kind: 'error' as const, error })
    ),
    Math.max(1, Math.min(READ_TIMEOUT_MS, deadline - Date.now())),
    null
  )
  if (!outcome) {
    const error = linearError('linear_timeout', 'Linear content read timed out.')
    controller.abort(error)
    throw error
  }
  if (outcome.kind === 'error') {
    throw outcome.error
  }
  const parsed = envelope.safeParse(outcome.value)
  if (!parsed.success || parsed.data.errors?.length) {
    throw linearError('linear_partial', 'Linear returned incomplete content.')
  }
  return parsed.data.data
}

function requireParsed<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    throw linearError('linear_partial', 'Required Linear content is missing.')
  }
  return parsed.data
}

function checkContentSize(value: unknown): void {
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > CONTENT_BYTES_CAP) {
    throw linearError('linear_partial', 'Linear content exceeds the read size limit.')
  }
}

export async function readLinearDocumentContent(
  request: LinearContentReadRequest
): Promise<LinearDocumentReadResult> {
  if (!request.id.trim()) {
    throw linearError('linear_invalid_url', 'A document id or slug is required.')
  }
  const data = await readContent(request, DOCUMENT_CONTENT_QUERY, { id: request.id })
  const { document } = requireParsed(z.object({ document: LinearDocumentContent }), data)
  if (document.id !== request.id && document.slugId !== request.id) {
    throw linearError(
      'linear_partial',
      'Resolved document does not match the requested id or slug.'
    )
  }
  checkContentSize(document)
  return {
    document: { ...document, workspaceId: request.workspaceId },
    meta: {
      resolved: { id: document.id, workspaceId: request.workspaceId },
      partial: false,
      includeErrors: [],
      contentComplete: true
    }
  }
}

export async function readLinearProjectContent(
  request: LinearProjectReadRequest
): Promise<LinearProjectReadResult> {
  if (!isLinearUuid(request.id)) {
    throw linearError('linear_invalid_project', 'A project UUID is required.')
  }
  const deadline = Date.now() + 60_000
  const documents: LinearProjectReadResult['documents'] = []
  const seen = new Set<string>()
  const cursors = new Set<string>()
  let after: string | undefined
  let firstProject: z.infer<typeof LinearProjectContent> | undefined
  let hasMore = false
  let nextCursor: string | null = null
  do {
    if (Date.now() >= deadline) {
      throw linearError('linear_timeout', 'Linear project read timed out.')
    }
    const data = await readContent(
      request,
      PROJECT_CONTENT_QUERY,
      {
        id: request.id,
        full: request.full,
        first: Math.min(PAGE_SIZE, DOCUMENT_CAP - documents.length),
        ...(after ? { after } : {})
      },
      deadline
    )
    const { project } = requireParsed(z.object({ project: projectPage }), data)
    if (project.id !== request.id) {
      throw linearError('linear_partial', 'Resolved project does not match the requested UUID.')
    }
    const current = LinearProjectContent.parse(project)
    if (firstProject && JSON.stringify(firstProject) !== JSON.stringify(current)) {
      throw linearError('linear_partial', 'Project changed during pagination; read it again.')
    }
    firstProject = current
    if (!request.full) {
      break
    }
    if (!project.documents) {
      throw linearError('linear_partial', 'Project documents were not returned.')
    }
    for (const document of project.documents.nodes) {
      if (document.project?.id !== project.id || seen.has(document.id)) {
        throw linearError(
          'linear_partial',
          'Project document membership or pagination is inconsistent.'
        )
      }
      seen.add(document.id)
      documents.push({ ...document, workspaceId: request.workspaceId })
    }
    if (documents.length > DOCUMENT_CAP) {
      throw linearError('linear_partial', 'Document cap exceeded.')
    }
    checkContentSize({ project: current, documents })
    hasMore = project.documents.pageInfo.hasNextPage
    nextCursor = project.documents.pageInfo.endCursor
    if (
      hasMore &&
      (!nextCursor || cursors.has(nextCursor) || project.documents.nodes.length === 0)
    ) {
      throw linearError('linear_partial', 'Project document pagination did not advance.')
    }
    if (nextCursor) {
      cursors.add(nextCursor)
    }
    after = nextCursor ?? undefined
  } while (hasMore && documents.length < DOCUMENT_CAP)
  checkContentSize({ project: firstProject, documents })
  return {
    project: { ...firstProject, workspaceId: request.workspaceId },
    documents,
    meta: {
      resolved: { id: request.id, workspaceId: request.workspaceId },
      partial: hasMore,
      includeErrors: hasMore
        ? [{ include: 'documents', code: 'linear_partial', message: 'Document read cap reached.' }]
        : [],
      sections: request.full
        ? {
            documents: {
              returned: documents.length,
              cap: DOCUMENT_CAP,
              capReached: hasMore,
              hasMore,
              nextCursor
            }
          }
        : {}
    }
  }
}
