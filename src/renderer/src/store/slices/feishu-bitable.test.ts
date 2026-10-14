import { beforeEach, describe, expect, it, vi } from 'vitest'
import { create } from 'zustand'
import type { AppState } from '../types'
import type { FeishuBitableReadResult } from '../../../../shared/feishu-bitable-types'
import { createFeishuBitableSlice } from './feishu-bitable'

const listRecords = vi.fn()
const status = vi.fn()
const selectConnection = vi.fn()
const completeRecord = vi.fn()
vi.mock('@/runtime/runtime-feishu-bitable-client', () => ({
  feishuBitableCompleteRecord: (...args: unknown[]) => completeRecord(...args),
  getFeishuBitableRuntimeTarget: () => ({ kind: 'local' }),
  feishuBitableListRecords: (...args: unknown[]) => listRecords(...args),
  feishuBitableStatus: (...args: unknown[]) => status(...args),
  feishuBitableConnect: vi.fn(),
  feishuBitableDisconnect: vi.fn(),
  feishuBitableGetRecord: vi.fn(),
  feishuBitableListFields: vi.fn(),
  feishuBitableSelectConnection: (...args: unknown[]) => selectConnection(...args),
  feishuBitableUpdateFieldMapping: vi.fn()
}))

function createStore() {
  return create<AppState>()((...args) => {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: this isolated slice only reads settings and its own state; unrelated slices are never accessed.
    return { settings: null, ...createFeishuBitableSlice(...args) } as AppState
  })
}

function deferredRead() {
  let resolve: (result: FeishuBitableReadResult) => void = () => {}
  const promise = new Promise<FeishuBitableReadResult>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const emptyPage: FeishuBitableReadResult = {
  ok: true,
  page: { tasks: [], nextPageToken: null, totalFetched: 0 }
}

describe('Feishu record read ownership', () => {
  beforeEach(() => vi.clearAllMocks())

  it('ignores an older refresh finishing after a newer refresh', async () => {
    const store = createStore()
    const first = deferredRead()
    listRecords
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ ok: false, error: 'New result' })
    const oldRead = store.getState().fetchFeishuBitableRecords()
    await store.getState().fetchFeishuBitableRecords()
    first.resolve(emptyPage)
    await oldRead
    expect(store.getState().feishuBitableError).toBe('New result')
    expect(store.getState().feishuBitableLoading).toBe(false)
  })

  it('ignores records returned for a connection that is no longer selected', async () => {
    const store = createStore()
    const read = deferredRead()
    listRecords.mockReturnValueOnce(read.promise)
    const pending = store.getState().fetchFeishuBitableRecords()
    store.setState({
      feishuBitableStatus: { connected: true, connections: [], activeConnectionId: 'other' }
    })
    read.resolve({ ok: false, error: 'Stale connection' })
    await pending
    expect(store.getState().feishuBitableError).toBeNull()
  })

  it('clears stale selection and reports old-host method errors', async () => {
    const store = createStore()
    status.mockRejectedValueOnce(new Error('Update Orca on the remote host first.'))
    store.setState({ feishuBitableNextPageToken: 'old-page', feishuBitableLoading: true })
    await store.getState().checkFeishuBitableConnection()
    expect(store.getState().feishuBitableNextPageToken).toBeNull()
    expect(store.getState().feishuBitableLoading).toBe(false)
    expect(store.getState().feishuBitableError).toContain('Update Orca')
    expect(store.getState().feishuBitableStatusChecked).toBe(true)
  })
})

it('does not leave loading stuck when selecting a connection fails', async () => {
  const store = createStore()
  store.setState({ feishuBitableLoading: true })
  selectConnection.mockRejectedValueOnce(new Error('Disconnected'))
  await expect(store.getState().selectFeishuBitableConnection('other')).rejects.toThrow(
    'Disconnected'
  )
  expect(store.getState().feishuBitableLoading).toBe(false)
})

it('keeps the latest connection status when an older check finishes late', async () => {
  const store = createStore()
  let finish: (value: {
    connected: false
    connections: []
    activeConnectionId: null
  }) => void = () => {}
  status.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve
    })
  )
  const oldCheck = store.getState().checkFeishuBitableConnection()
  status.mockRejectedValueOnce(new Error('Latest host check'))
  await store.getState().checkFeishuBitableConnection()
  finish({ connected: false, connections: [], activeConnectionId: null })
  await oldCheck
  expect(store.getState().feishuBitableError).toBe('Latest host check')
})

it('retains field order and empty columns across pagination, then clears them on refresh', async () => {
  const store = createStore()
  const fields = [
    { fieldName: 'Title', type: 1 },
    { fieldName: 'Empty', type: 1 }
  ]
  listRecords
    .mockResolvedValueOnce({
      ok: true,
      page: { tasks: [], fields, nextPageToken: 'next', totalFetched: 0 }
    })
    .mockResolvedValueOnce(emptyPage)
    .mockResolvedValueOnce(emptyPage)
  await store.getState().fetchFeishuBitableRecords()
  expect(store.getState().feishuBitableFields).toEqual(fields)
  await store.getState().fetchFeishuBitableRecords({ pageToken: 'next', append: true })
  expect(store.getState().feishuBitableFields).toEqual(fields)
  await store.getState().fetchFeishuBitableRecords()
  expect(store.getState().feishuBitableFields).toEqual([])
})

const record = { connectionId: 'c', appToken: 'a', tableId: 't', recordId: 'r' }
const task = {
  record,
  source: record,
  title: 'Task',
  description: '',
  connectionLabel: 'Board',
  fieldValues: { Status: 'Todo' }
}
it('applies an explicit completed record by full identity and fences older pending reads', async () => {
  const store = createStore()
  const otherRecord = { ...record, tableId: 'other' }
  const other = { ...task, record: otherRecord, source: otherRecord }
  store.setState({ feishuBitableTasks: [task, other], selectedFeishuBitableTask: task })
  const read = deferredRead()
  listRecords.mockReturnValueOnce(read.promise)
  const staleRead = store.getState().fetchFeishuBitableRecords()
  const updated = { ...task, fieldValues: { Status: 'Done' } }
  completeRecord.mockResolvedValueOnce({ ok: true, task: updated })
  await store.getState().completeFeishuBitableRecord({ record }, { kind: 'local' })
  read.resolve(emptyPage)
  await staleRead
  expect(store.getState().feishuBitableTasks).toEqual([updated, other])
  expect(store.getState().selectedFeishuBitableTask).toEqual(updated)
})
it('does not overwrite a newly selected connection when a completion returns late', async () => {
  const store = createStore()
  store.setState({ feishuBitableTasks: [task] })
  let finish: (value: { ok: true; task: typeof task }) => void = () => {}
  completeRecord.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve
    })
  )
  const write = store.getState().completeFeishuBitableRecord({ record }, { kind: 'local' })
  store.setState({
    feishuBitableStatus: { connected: true, connections: [], activeConnectionId: 'new' }
  })
  finish({ ok: true, task: { ...task, fieldValues: { Status: 'Done' } } })
  await write
  expect(store.getState().feishuBitableTasks).toEqual([task])
})
