import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Store } from '../persistence'

const handlers = new Map<string, (event: unknown, args: unknown) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, listener: (event: unknown, args: unknown) => unknown) => {
      handlers.set(channel, listener)
    },
    removeHandler: (channel: string) => {
      handlers.delete(channel)
    }
  }
}))

import { registerLocalTaskHandlers } from './local-tasks'

function createStore(): Store {
  const byProject: Record<string, { tasks: unknown[]; nextLocalTaskId: number }> = {}
  return {
    listLocalTasks: vi.fn((projectId: string) => [...(byProject[projectId]?.tasks ?? [])]),
    createLocalTask: vi.fn((projectId: string, input: { title: string }) => {
      const bucket = (byProject[projectId] ??= { tasks: [], nextLocalTaskId: 1 })
      const task = {
        id: bucket.nextLocalTaskId,
        url: `u/${bucket.nextLocalTaskId}`,
        title: input.title
      }
      bucket.tasks.push(task)
      bucket.nextLocalTaskId += 1
      return task
    }),
    updateLocalTask: vi.fn(),
    deleteLocalTask: vi.fn(),
    pruneLocalTasksForRemovedProjects: vi.fn()
  } as unknown as Store
}

describe('registerLocalTaskHandlers', () => {
  afterEach(() => {
    handlers.clear()
  })

  it('routes list/create through the store', async () => {
    registerLocalTaskHandlers(createStore())

    const created = (await handlers.get('local-tasks:create')?.(
      {},
      { projectId: 'p', title: 'T' }
    )) as {
      id: number
    }
    expect(created.id).toBe(1)
    expect(await handlers.get('local-tasks:list')?.({}, { projectId: 'p' })).toHaveLength(1)
  })
})
