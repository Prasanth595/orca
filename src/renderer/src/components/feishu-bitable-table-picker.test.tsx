// @vitest-environment happy-dom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FeishuBitableTablePicker } from './feishu-bitable-table-picker'
import type { FeishuBitableTableDiscoveryResult } from '../../../shared/feishu-bitable-table-discovery'
const discover = vi.hoisted(() => vi.fn())
vi.mock('@/runtime/runtime-feishu-bitable-client', () => ({
  feishuBitableDiscoverTables: discover
}))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))
const settings = { kind: 'default-scope', settings: null } as const
const props = {
  open: true,
  settings,
  appId: 'cli123',
  appSecret: 'secret',
  appToken: 'base123',
  tableId: '',
  disabled: false,
  onAppTokenChange: vi.fn(),
  onTableIdChange: vi.fn()
}
beforeEach(() => {
  discover.mockReset()
  props.onTableIdChange.mockReset()
})
afterEach(cleanup)
describe('FeishuBitableTablePicker', () => {
  it('loads and selects a single table without requiring a manual ID', async () => {
    discover.mockResolvedValue({ ok: true, tables: [{ tableId: 'tbl123', name: 'Tasks' }] })
    const view = render(<FeishuBitableTablePicker {...props} />)
    fireEvent.click(view.getByRole('button', { name: 'Load data tables' }))
    await waitFor(() => expect(props.onTableIdChange).toHaveBeenCalledWith('tbl123'))
    expect(view.getByRole('combobox')).toBeDefined()
    expect(discover).toHaveBeenCalledWith(settings, {
      appId: 'cli123',
      appSecret: 'secret',
      appToken: 'base123'
    })
  })
  it('ignores stale discovery after credentials change', async () => {
    let finish: ((value: FeishuBitableTableDiscoveryResult) => void) | undefined
    discover.mockReturnValue(
      new Promise<FeishuBitableTableDiscoveryResult>((resolve) => {
        finish = resolve
      })
    )
    const view = render(<FeishuBitableTablePicker {...props} />)
    fireEvent.click(view.getByRole('button', { name: 'Load data tables' }))
    view.rerender(<FeishuBitableTablePicker {...props} appSecret="new-secret" />)
    finish?.({ ok: true, tables: [{ tableId: 'old-table', name: 'Old' }] })
    await waitFor(() =>
      expect(view.getByRole('button', { name: 'Load data tables' })).toBeDefined()
    )
    expect(props.onTableIdChange).not.toHaveBeenCalled()
    expect(view.queryByRole('combobox')).toBeNull()
  })
  it('keeps manual input usable when a host does not support discovery', async () => {
    discover.mockRejectedValue(new Error('Update Orca on the remote host first.'))
    const view = render(<FeishuBitableTablePicker {...props} />)
    fireEvent.click(view.getByRole('button', { name: 'Load data tables' }))
    await waitFor(() => expect(view.getByRole('alert').textContent).toContain('Update Orca'))
    fireEvent.change(view.getByLabelText('Table ID (or enter manually)'), {
      target: { value: 'tblManual' }
    })
    expect(props.onTableIdChange).toHaveBeenCalledWith('tblManual')
  })
})
