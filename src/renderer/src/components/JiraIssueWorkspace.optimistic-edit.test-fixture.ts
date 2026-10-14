import { act, fireEvent, screen } from '@testing-library/react'
import type { JiraIssue } from '../../../shared/jira-types'
import type { TaskSourceContext } from '../../../shared/task-source-context'
import { getJiraReadIdentity } from '@/store/slices/jira-read-coordination'

export function jiraIssue(title: string, overrides: Partial<JiraIssue> = {}): JiraIssue {
  return {
    id: '10001',
    key: 'ENG-1',
    siteId: 'site-1',
    title,
    url: 'https://example.atlassian.net/browse/ENG-1',
    project: { id: '1', key: 'ENG', name: 'Engineering' },
    issueType: { id: '1', name: 'Task' },
    status: { id: '1', name: 'To Do', categoryKey: 'new', categoryName: 'To Do' },
    labels: [],
    updatedAt: '2026-09-01T00:00:00.000Z',
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides
  }
}

export const otherIssue = jiraIssue('Other issue', { id: '10002', key: 'ENG-2' })

export const initialSource: TaskSourceContext = {
  kind: 'task-source',
  provider: 'jira',
  projectId: 'project-1',
  hostId: 'local'
}
export const initialSourceContextKey = getJiraReadIdentity(null, initialSource).contextKey

export const pendingRequests = new Set<(error: Error) => void>()

export function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve = (_value: T): void => undefined
  let reject = (_error: Error): void => undefined
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  pendingRequests.add(reject)
  void promise.then(
    () => pendingRequests.delete(reject),
    () => pendingRequests.delete(reject)
  )
  return { promise, resolve }
}

export async function flushPromises(): Promise<void> {
  await act(async () => {
    await new Promise((done) => setTimeout(done, 0))
  })
}

export function saveTitle(from: string, to: string): void {
  const input = screen.getByDisplayValue(from)
  fireEvent.change(input, { target: { value: to } })
  fireEvent.keyDown(input, { key: 'Enter' })
}
