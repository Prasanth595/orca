// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { TaskPageLocalBoard } from './Board'
import type { LocalTask } from '../../../../../shared/local-task'

afterEach(() => {
  cleanup()
})

function makeTask(overrides: Partial<LocalTask> & { id: number }): LocalTask {
  return {
    url: `orca://local-task/v1/p/${overrides.id}`,
    title: `Task ${overrides.id}`,
    description: '',
    status: 'todo',
    createdAt: overrides.id,
    updatedAt: overrides.id,
    ...overrides
  }
}

const noop = () => {}

describe('TaskPageLocalBoard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders one column per status with tasks in creation order', () => {
    const tasks = [makeTask({ id: 2 }), makeTask({ id: 1, status: 'done' }), makeTask({ id: 3 })]
    render(
      <TaskPageLocalBoard
        tasks={tasks}
        loading={false}
        unreadable={false}
        hasProject={true}
        onRetry={noop}
        onCreate={noop}
        onEdit={noop}
        onDeleteRequest={noop}
        onMove={noop}
        onOpenWorktree={noop}
      />
    )
    for (const status of ['todo', 'in-progress', 'done'] as const) {
      expect(screen.getByTestId(`local-column-${status}`)).toBeDefined()
    }
    const todoColumn = screen.getByTestId('local-column-todo')
    const titles = Array.from(todoColumn.querySelectorAll('[data-task-title]')).map(
      (el) => el.textContent
    )
    expect(titles).toEqual(['Task 2', 'Task 3'])
  })

  it('shows the empty state with a create action when the project has no tasks', () => {
    const onCreate = vi.fn()
    render(
      <TaskPageLocalBoard
        tasks={[]}
        loading={false}
        unreadable={false}
        hasProject={true}
        onRetry={noop}
        onCreate={onCreate}
        onEdit={noop}
        onDeleteRequest={noop}
        onMove={noop}
        onOpenWorktree={noop}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /new task/i }))
    expect(onCreate).toHaveBeenCalledTimes(1)
  })

  it('shows the no-project empty state with creation disabled', () => {
    render(
      <TaskPageLocalBoard
        tasks={[]}
        loading={false}
        unreadable={false}
        hasProject={false}
        onRetry={noop}
        onCreate={noop}
        onEdit={noop}
        onDeleteRequest={noop}
        onMove={noop}
        onOpenWorktree={noop}
      />
    )
    expect(screen.getByText(/no active project/i)).toBeDefined()
    expect(screen.queryByRole('button', { name: /new task/i })).toBeNull()
  })

  it('blocks mutations and offers retry when the domain is unreadable', () => {
    const onRetry = vi.fn()
    const onCreate = vi.fn()
    render(
      <TaskPageLocalBoard
        tasks={[]}
        loading={false}
        unreadable={true}
        hasProject={true}
        onRetry={onRetry}
        onCreate={onCreate}
        onEdit={noop}
        onDeleteRequest={noop}
        onMove={noop}
        onOpenWorktree={noop}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('invokes edit, delete, and move actions from a card', () => {
    const onEdit = vi.fn()
    const onDeleteRequest = vi.fn()
    const onMove = vi.fn()
    const task = makeTask({ id: 1 })
    render(
      <TaskPageLocalBoard
        tasks={[task]}
        loading={false}
        unreadable={false}
        hasProject={true}
        onRetry={noop}
        onCreate={noop}
        onEdit={onEdit}
        onDeleteRequest={onDeleteRequest}
        onMove={onMove}
        onOpenWorktree={noop}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /edit task 1/i }))
    expect(onEdit).toHaveBeenCalledWith(task)
    fireEvent.click(screen.getByRole('button', { name: /delete task 1/i }))
    expect(onDeleteRequest).toHaveBeenCalledWith(task)
    fireEvent.click(screen.getByRole('button', { name: /move to done/i }))
    expect(onMove).toHaveBeenCalledWith(task, 'done')
  })
})
