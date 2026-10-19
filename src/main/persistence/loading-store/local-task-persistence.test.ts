import { afterEach, describe, expect, it } from 'vitest'
import { Store } from './store'
import { closeTestStores, createSqliteTestStore } from '../../persistence-test-harness'

afterEach(() => {
  closeTestStores()
})

function createStore(): Store {
  return createSqliteTestStore(Store)
}

describe('LocalTaskPersistence', () => {
  it('creates tasks with minted ids and urls, lists, updates, and deletes', () => {
    const store = createStore()
    const created = store.createLocalTask('project-a', { title: 'First', description: 'D' })
    expect(created).toEqual({
      id: 1,
      url: 'orca://local-task/v1/project-a/1',
      title: 'First',
      description: 'D',
      status: 'todo',
      createdAt: expect.any(Number),
      updatedAt: expect.any(Number)
    })
    const second = store.createLocalTask('project-a', { title: 'Second' })
    expect(second.id).toBe(2)
    expect(store.listLocalTasks('project-a').map((task) => task.id)).toEqual([1, 2])

    const moved = store.updateLocalTask('project-a', 1, { status: 'in-progress' })
    expect(moved?.status).toBe('in-progress')

    expect(store.deleteLocalTask('project-a', 1)).toBe(true)
    expect(store.listLocalTasks('project-a').map((task) => task.id)).toEqual([2])

    // Deleted ids are never reused.
    const third = store.createLocalTask('project-a', { title: 'Third' })
    expect(third.id).toBe(3)
  })

  it('scopes tasks per project and drops unknown projects on prune', () => {
    const store = createStore()
    store.createLocalTask('project-a', { title: 'A' })
    store.createLocalTask('project-b', { title: 'B' })
    expect(store.listLocalTasks('project-a').map((task) => task.title)).toEqual(['A'])
    expect(store.listLocalTasks('project-b').map((task) => task.title)).toEqual(['B'])

    store.pruneLocalTasksForRemovedProjects(['project-a'])
    expect(store.listLocalTasks('project-a')).toHaveLength(1)
    expect(store.listLocalTasks('project-b')).toHaveLength(0)
  })

  it('rejects blank titles and misses on unknown ids', () => {
    const store = createStore()
    expect(() => store.createLocalTask('project-a', { title: '  ' })).toThrow()
    expect(store.updateLocalTask('project-a', 999, { status: 'done' })).toBeNull()
    expect(store.deleteLocalTask('project-a', 999)).toBe(false)
  })
})
