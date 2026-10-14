// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FeishuBitableCompletion } from './Completion'
const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
  mapping: { statusField: 'Status', completedValue: 'Done' }
}))
vi.mock('@/store', () => ({
  useAppStore: (selector: (state: unknown) => unknown) =>
    selector({
      completeFeishuBitableRecord: mocks.complete,
      feishuBitableStatus: { connections: [{ id: 'c', fieldMapping: mocks.mapping }] }
    })
}))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
const record = { connectionId: 'c', appToken: 'a', tableId: 't', recordId: 'r' }
const task = {
  record,
  source: record,
  title: 'Task',
  description: '',
  connectionLabel: 'Board',
  fieldValues: { Status: 'Todo' }
}
const source = { kind: 'environment', environmentId: 'ssh-host' } as const
afterEach(cleanup)
beforeEach(() => {
  vi.resetAllMocks()
  mocks.mapping = { statusField: 'Status', completedValue: 'Done' }
})
describe('manual Feishu completion', () => {
  it('writes only on explicit click, never on render or idle re-render', async () => {
    mocks.complete.mockResolvedValue({
      ok: true,
      task: { ...task, fieldValues: { Status: 'Done' } }
    })
    const view = render(<FeishuBitableCompletion task={task} source={source} />)
    view.rerender(<FeishuBitableCompletion task={{ ...task }} source={source} />)
    expect(mocks.complete).not.toHaveBeenCalled()
    fireEvent.click(view.getByRole('button', { name: 'Mark complete' }))
    fireEvent.click(view.getByRole('button'))
    await waitFor(() => expect(view.getByRole('status').textContent).toContain('updated in Feishu'))
    expect(mocks.complete).toHaveBeenCalledTimes(1)
    expect(mocks.complete).toHaveBeenCalledWith({ record }, source)
  })
  it('explains missing mapping and does not dispatch', () => {
    mocks.mapping = { statusField: '', completedValue: '' }
    const view = render(<FeishuBitableCompletion task={task} source={source} />)
    expect(view.getByText(/Configure a status field/)).toBeDefined()
    fireEvent.click(view.getByRole('button'))
    expect(mocks.complete).not.toHaveBeenCalled()
  })
  it('keeps denied writes retryable and never claims success', async () => {
    mocks.complete.mockResolvedValue({
      ok: false,
      error:
        'The app needs record write permission and access to this status field. Reading remains available.'
    })
    const view = render(<FeishuBitableCompletion task={task} source={source} />)
    fireEvent.click(view.getByRole('button', { name: 'Mark complete' }))
    await waitFor(() =>
      expect(view.getByRole('alert').textContent).toContain('Reading remains available')
    )
    expect(view.queryByRole('status')).toBeNull()
    expect(view.getByRole('button').hasAttribute('disabled')).toBe(false)
  })
})
