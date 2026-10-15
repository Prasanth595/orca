import type {
  LinearDocumentReadResult,
  LinearProjectReadResult
} from '../../shared/linear/context-read'
import { isLinearUuid } from '../../shared/linear/uuid'
import type { CommandHandler } from '../dispatch'
import { getRequiredStringFlag } from '../flags'
import { printResult } from '../format'
import { RuntimeClientError } from '../runtime-client'

function workspaceUuid(flags: Parameters<CommandHandler>[0]['flags']): string {
  const value = getRequiredStringFlag(flags, 'workspace')
  if (!isLinearUuid(value)) {
    throw new RuntimeClientError('linear_invalid_workspace', 'Pass a concrete workspace UUID.')
  }
  return value
}

export const readLinearProject: CommandHandler = async ({ flags, client, json }) => {
  const id = getRequiredStringFlag(flags, 'id')
  const workspaceId = workspaceUuid(flags)
  if (!isLinearUuid(id)) {
    throw new RuntimeClientError('linear_invalid_project', 'Pass a project UUID.')
  }
  const response = await client.call<LinearProjectReadResult>(
    'linear.agentProjectRead',
    { id, workspaceId, full: flags.get('full') === true },
    { timeoutMs: 120_000 }
  )
  printResult(response, json, (result) =>
    [
      result.project.name,
      result.project.description ?? '',
      result.project.content ?? '',
      ...result.documents.map((document) => `${document.title}\n${document.content ?? ''}`),
      ...(result.meta.partial ? ['Warning: project documents are incomplete.'] : [])
    ].join('\n\n')
  )
}

export const readLinearDocument: CommandHandler = async ({ flags, client, json }) => {
  const response = await client.call<LinearDocumentReadResult>(
    'linear.agentDocumentRead',
    { id: getRequiredStringFlag(flags, 'id'), workspaceId: workspaceUuid(flags) },
    { timeoutMs: 45_000 }
  )
  printResult(
    response,
    json,
    (result) => `${result.document.title}\n\n${result.document.content ?? ''}`
  )
}

export const LINEAR_CONTENT_READ_HANDLERS: Record<string, CommandHandler> = {
  'linear project get': readLinearProject,
  'linear document get': readLinearDocument
}
