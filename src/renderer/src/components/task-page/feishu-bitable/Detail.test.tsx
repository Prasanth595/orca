// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { FeishuBitableTaskDetail } from './Detail'
vi.mock('./Completion', () => ({ FeishuBitableCompletion: () => null }))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
const record = { connectionId: 'c', appToken: 'a', tableId: 't', recordId: 'r' }
const task = {
  record,
  source: record,
  title: 'Original title',
  description: 'Artificial description',
  acceptanceCriteria: 'Artificial criteria',
  connectionLabel: 'Board',
  fieldValues: { Name: 'Original title', Status: 'Todo' }
}
const fields = [
  { fieldName: 'Name', type: 1 },
  { fieldName: 'Empty', type: 1 },
  { fieldName: 'Status', type: 3 }
]
afterEach(cleanup)
it('shows original fields in their original order, including empty columns, without artificial sections', () => {
  const view = render(
    <FeishuBitableTaskDetail
      task={task}
      fields={fields}
      source={{ kind: 'local' }}
      onUse={vi.fn()}
      onBack={vi.fn()}
    />
  )
  expect([...view.container.querySelectorAll('dt')].map((node) => node.textContent)).toEqual([
    'Name',
    'Empty',
    'Status'
  ])
  expect([...view.container.querySelectorAll('dd')].map((node) => node.textContent)).toEqual([
    'Original title',
    '—',
    'Todo'
  ])
  expect(view.queryByText('Artificial description')).toBeNull()
  expect(view.queryByText('Artificial criteria')).toBeNull()
})
it('labels an attached workspace action accurately and keeps it separate from the back action', () => {
  const onUse = vi.fn()
  const onBack = vi.fn()
  const view = render(
    <FeishuBitableTaskDetail
      task={task}
      fields={fields}
      source={{ kind: 'local' }}
      hasWorkspace
      onUse={onUse}
      onBack={onBack}
    />
  )
  fireEvent.click(view.getByRole('button', { name: 'Open workspace' }))
  expect(onUse).toHaveBeenCalledTimes(1)
  expect(onBack).not.toHaveBeenCalled()
  fireEvent.click(view.getByRole('button', { name: 'Records' }))
  expect(onBack).toHaveBeenCalledTimes(1)
})
