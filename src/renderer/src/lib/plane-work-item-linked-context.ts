import type { PlaneWorkItem } from '../../../shared/plane-types'
import {
  LINKED_CONTEXT_BLOCK_MAX_CHARS,
  type LinkedWorkItemContext
} from './linked-work-item-context'

const TRUNCATION_MARKER = '[description truncated]'

export type PlaneLinkedContextItem = Pick<
  PlaneWorkItem,
  'identifier' | 'name' | 'state' | 'projectIdentifier' | 'url'
> & { descriptionText?: string }

/** Plain-text snapshot of a Plane work item for agents, under the shared linked-context cap. */
export function buildPlaneWorkItemLinkedContext(
  item: PlaneLinkedContextItem,
  options: { projectName?: string } = {}
): LinkedWorkItemContext {
  const project = options.projectName
    ? `${options.projectName} (${item.projectIdentifier})`
    : item.projectIdentifier
  const header = [
    `Plane work item: ${item.identifier}`,
    `Title: ${item.name}`,
    ...(item.state ? [`State: ${item.state.name} (${item.state.group})`] : []),
    `Project: ${project}`,
    `URL: ${item.url}`
  ].join('\n')
  const description = item.descriptionText?.trim()
  if (!description) {
    return { provider: 'plane', version: 1, renderedText: header }
  }
  const prefix = `${header}\n\nDescription:\n`
  const budget = LINKED_CONTEXT_BLOCK_MAX_CHARS - prefix.length
  const body =
    description.length <= budget
      ? description
      : `${description.slice(0, Math.max(0, budget - TRUNCATION_MARKER.length - 1)).trimEnd()}\n${TRUNCATION_MARKER}`
  return { provider: 'plane', version: 1, renderedText: `${prefix}${body}` }
}
