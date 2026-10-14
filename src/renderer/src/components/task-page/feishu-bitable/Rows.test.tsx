import { makeWorktree } from '@/store/slices/worktrees-slice-test-fixtures'
// @vitest-environment happy-dom
import { cleanup, fireEvent, render, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TaskPageFeishuBitableRows } from './Rows'
import type { FeishuBitableTask } from '../../../../../shared/feishu-bitable-types'
vi.mock('@/i18n/i18n', () => ({
  translate: (_key: string, fallback: string, options?: Record<string, unknown>) =>
    fallback.replace(/{{(\w+)}}/g, (_match, key: string) => String(options?.[key] ?? ''))
}))
vi.mock('@/store', () => ({
  useAppStore: (selector: (state: unknown) => unknown) =>
    selector({
      folderWorkspaces: [],
      feishuBitableStatus: { connections: [], activeConnectionId: null }
    })
}))
afterEach(cleanup)
const source = { connectionId: 'c', appToken: 'a', tableId: 't', recordId: 'r' }
const tasks: FeishuBitableTask[] = [
  {
    source,
    record: source,
    title: 'First task',
    description: '',
    connectionLabel: 'Board',
    fieldValues: { Title: 'First task', Owner: 'Alice', Score: '0' }
  },
  {
    source: { ...source, recordId: 'r2' },
    record: { ...source, recordId: 'r2' },
    title: 'Second task',
    description: '',
    connectionLabel: 'Board',
    fieldValues: { Title: 'Second task', Owner: 'Bob', Score: '3' }
  }
]
const fields = ['Title', 'Owner', 'Score', 'Empty'].map((fieldName) => ({ fieldName, type: 1 }))
function model() {
  return {
    allWorktrees: [],
    feishuBitableTaskSourceContext: null,
    setSelectedFeishuBitableTask: vi.fn(),
    handleUseFeishuBitableTask: vi.fn(),
    openComposerForFeishuBitableTask: vi.fn()
  }
}
describe('Feishu task table', () => {
  it('shows every column in metadata order, including entirely empty columns', () => {
    const view = render(<TaskPageFeishuBitableRows tasks={tasks} fields={fields} model={model()} />)
    expect(view.getAllByRole('columnheader').map((node) => node.textContent)).toEqual([
      'Title',
      'Owner',
      'Score',
      'Empty',
      'Actions'
    ])
    const row = view.getAllByRole('row')[1]
    expect(within(row).getByText('Alice')).toBeDefined()
    expect(within(row).getByText('0')).toBeDefined()
    expect(within(row).getByText('—')).toBeDefined()
    expect(within(row).getAllByRole('cell')).toHaveLength(fields.length + 1)
    expect(within(row).getAllByText('First task')).toHaveLength(1)
    const detail = within(row).getByRole('button', { name: 'View record: First task' })
    expect(detail.getAttribute('type')).toBe('button')
    detail.focus()
    expect(document.activeElement).toBe(detail)
    expect(row.querySelector('button button')).toBeNull()
  })
  it('starts the composer with the clicked record without opening its detail page', () => {
    const actions = model()
    const view = render(<TaskPageFeishuBitableRows tasks={tasks} fields={fields} model={actions} />)
    expect(view.getAllByRole('button', { name: /Start new workspace:/ })).toHaveLength(2)
    fireEvent.click(view.getByRole('button', { name: 'Start new workspace: Second task' }))
    expect(actions.openComposerForFeishuBitableTask).toHaveBeenCalledWith(tasks[1])
    expect(actions.setSelectedFeishuBitableTask).not.toHaveBeenCalled()
    fireEvent.click(view.getByRole('button', { name: 'View record: First task' }))
    expect(actions.setSelectedFeishuBitableTask).toHaveBeenCalledWith(tasks[0])
  })
  it('opens the workspace associated by full record identity and keeps the new-workspace action', () => {
    const actions = model()
    const attached = makeWorktree({
      id: 'attached',
      repoId: 'repo',
      linkedItems: [
        {
          provider: 'feishu-bitable',
          type: 'issue',
          number: 0,
          title: tasks[0].title,
          feishuRecord: source
        }
      ]
    })
    const view = render(
      <TaskPageFeishuBitableRows
        tasks={tasks}
        fields={fields}
        model={{ ...actions, allWorktrees: [attached] }}
      />
    )
    expect(view.queryByRole('button', { name: 'Open: Second task' })).toBeNull()
    fireEvent.click(view.getByRole('button', { name: 'Open: First task' }))
    expect(actions.handleUseFeishuBitableTask).toHaveBeenCalledWith(tasks[0])
    expect(actions.openComposerForFeishuBitableTask).not.toHaveBeenCalled()
    expect(view.getAllByRole('button', { name: /Start new workspace:/ })).toHaveLength(2)
  })
  it('can still start workspaces from older host records without optional field values', () => {
    const actions = model()
    const legacy = { ...tasks[0], fieldValues: undefined }
    const view = render(<TaskPageFeishuBitableRows tasks={[legacy]} fields={[]} model={actions} />)
    fireEvent.click(view.getByRole('button', { name: 'Start new workspace: First task' }))
    expect(actions.openComposerForFeishuBitableTask).toHaveBeenCalledWith(legacy)
  })
})
