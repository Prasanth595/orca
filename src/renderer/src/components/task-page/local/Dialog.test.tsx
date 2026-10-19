// @vitest-environment happy-dom
import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { TaskPageLocalDialog } from './Dialog'
afterEach(() => {
  cleanup()
})

const noop = () => {}

describe('TaskPageLocalDialog', () => {
  it('creates a task with title and description', () => {
    const onCreate = vi.fn().mockResolvedValue({
      id: 1,
      url: 'orca://local-task/v1/p/1',
      title: 'My task',
      description: 'Details',
      status: 'todo',
      createdAt: 1,
      updatedAt: 1
    })
    const onClose = vi.fn()
    render(
      <TaskPageLocalDialog
        dialog={{ mode: 'create' }}
        onClose={onClose}
        onCreate={onCreate}
        onUpdate={async () => null}
        onDeleteConfirm={async () => false}
      />
    )
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: '  My task  ' } })
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'Details' } })
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }))
  })

  it('edits title, description, and status', () => {
    const onUpdate = vi.fn().mockResolvedValue({ id: 1 })
    const task = {
      id: 1,
      url: 'orca://local-task/v1/p/1',
      title: 'Old',
      description: 'Old desc',
      status: 'todo',
      createdAt: 1,
      updatedAt: 1
    } as const
    render(
      <TaskPageLocalDialog
        dialog={{ mode: 'edit', task }}
        onClose={noop}
        onCreate={async () => ({ ...task, id: 2 })}
        onUpdate={onUpdate}
        onDeleteConfirm={async () => false}
      />
    )
    expect((screen.getByLabelText(/title/i) as HTMLInputElement).value).toBe('Old')
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: 'New' } })
    fireEvent.change(screen.getByLabelText(/status/i), { target: { value: 'in-progress' } })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    expect(onUpdate).toHaveBeenCalledWith(1, {
      title: 'New',
      description: 'Old desc',
      status: 'in-progress'
    })
  })

  it('asks for confirmation before delete', () => {
    const onDeleteConfirm = vi.fn().mockResolvedValue(true)
    const task = {
      id: 1,
      url: 'orca://local-task/v1/p/1',
      title: 'Gone',
      description: '',
      status: 'todo',
      createdAt: 1,
      updatedAt: 1
    } as const
    render(
      <TaskPageLocalDialog
        dialog={{ mode: 'delete', task }}
        onClose={noop}
        onCreate={async () => ({ ...task, id: 2 })}
        onUpdate={async () => null}
        onDeleteConfirm={onDeleteConfirm}
      />
    )
    expect(screen.getByText(/delete this task/i)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    expect(onDeleteConfirm).toHaveBeenCalledWith(task)
  })
})
