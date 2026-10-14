import { describe, expect, it } from 'vitest'
import {
  buildContainedLinkedContextBlock,
  LINKED_CONTEXT_BLOCK_MAX_CHARS
} from './linked-work-item-context'
import { buildPlaneWorkItemLinkedContext } from './plane-work-item-linked-context'

const item = {
  identifier: 'WEB-12',
  name: 'Fix login',
  state: { id: 's', name: 'In Progress', group: 'started' as const, color: '', sequence: 1 },
  projectIdentifier: 'WEB',
  url: 'https://plane.example.test/acme/projects/p/issues/i'
}

describe('buildPlaneWorkItemLinkedContext', () => {
  it('renders identifier, title, state, project, URL and description as text', () => {
    const context = buildPlaneWorkItemLinkedContext(
      { ...item, descriptionText: 'Steps to reproduce' },
      { projectName: 'Website' }
    )
    expect(context).toEqual({
      provider: 'plane',
      version: 1,
      renderedText: [
        'Plane work item: WEB-12',
        'Title: Fix login',
        'State: In Progress (started)',
        'Project: Website (WEB)',
        `URL: ${item.url}`,
        '',
        'Description:',
        'Steps to reproduce'
      ].join('\n')
    })
  })

  it('truncates a long description under the shared linked-context cap', () => {
    const context = buildPlaneWorkItemLinkedContext({
      ...item,
      descriptionText: 'x'.repeat(LINKED_CONTEXT_BLOCK_MAX_CHARS * 2)
    })
    expect(context.renderedText.length).toBeLessThanOrEqual(LINKED_CONTEXT_BLOCK_MAX_CHARS)
    expect(context.renderedText.endsWith('[description truncated]')).toBe(true)
    expect(buildContainedLinkedContextBlock(context)?.length).toBeLessThanOrEqual(
      LINKED_CONTEXT_BLOCK_MAX_CHARS
    )
  })

  it('omits the description section when there is none', () => {
    expect(buildPlaneWorkItemLinkedContext(item).renderedText).not.toContain('Description:')
  })
})
