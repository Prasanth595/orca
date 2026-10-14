// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { FeishuBitableSetupSteps } from './FeishuBitableSetupSteps'
const mocks = vi.hoisted(() => ({ fields: vi.fn(), update: vi.fn() }))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
vi.mock('../feishu-bitable-connect-dialog', () => ({ FeishuBitableConnectDialog: () => null }))
vi.mock('./FeishuBitableConnectionPicker', () => ({ FeishuBitableConnectionPicker: () => null }))
vi.mock('./TaskSourceShowInTasksStep', () => ({ TaskSourceShowInTasksStep: () => null }))
const state = vi.hoisted(() => ({
  settings: null,
  feishuBitableStatus: {
    activeConnectionId: 'c',
    connections: [
      {
        id: 'c',
        label: 'Board',
        fieldMapping: {
          titleField: null,
          descriptionField: null,
          acceptanceCriteriaField: null,
          urlField: null,
          statusField: 'Status',
          completedValue: 'Done'
        }
      }
    ]
  }
}))
vi.mock('@/store', () => ({
  useAppStore: (selector: (state: unknown) => unknown) =>
    selector({
      ...state,
      fetchFeishuBitableFields: mocks.fields,
      updateFeishuBitableFieldMapping: mocks.update
    })
}))
afterEach(cleanup)
it('persists the completion mapping through the real settings action even when the title is unmapped', async () => {
  mocks.fields.mockResolvedValue({ ok: true, fields: [{ fieldName: 'Status', type: 1 }] })
  mocks.update.mockResolvedValue({ ok: true })
  const view = render(
    <FeishuBitableSetupSteps
      connected
      checking={false}
      visible
      canHide
      onToggleVisible={vi.fn()}
      onConnected={vi.fn()}
    />
  )
  await waitFor(() => expect(mocks.fields).toHaveBeenCalledWith('c'))
  await waitFor(() =>
    expect(view.getByRole('textbox', { name: 'Completion value' }).hasAttribute('disabled')).toBe(
      false
    )
  )
  fireEvent.change(view.getByRole('textbox', { name: 'Completion value' }), {
    target: { value: 'Finished' }
  })
  fireEvent.click(view.getByRole('button', { name: 'Save mapping' }))
  await waitFor(() =>
    expect(mocks.update).toHaveBeenCalledWith({
      connectionId: 'c',
      fieldMapping: {
        titleField: null,
        descriptionField: null,
        acceptanceCriteriaField: null,
        urlField: null,
        statusField: 'Status',
        completedValue: 'Finished'
      }
    })
  )
})
