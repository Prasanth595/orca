// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlaneState, PlaneWorkItem } from '../../../../../shared/plane-types'
import { PlaneStatePicker } from './PlaneStatePicker'
import { groupPlaneStates, usePlaneStateChange } from './plane-state-change'

const mocks = vi.hoisted(() => ({
  listStates: vi.fn(),
  updateState: vi.fn(),
  toastError: vi.fn()
}))
vi.mock('@/runtime/runtime-plane-client', () => ({
  planeListStatesForTarget: mocks.listStates,
  planeUpdateStateForTarget: mocks.updateState,
  isPlaneRuntimeUpdateRequiredError: () => false
}))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))
vi.mock('@/components/plane/use-plane-host-label', () => ({
  usePlaneHostLabel: () => 'Local Mac'
}))

const TARGET = { kind: 'local' } as const

function state(id: string, group: PlaneState['group'], sequence = 1): PlaneState {
  return { id, name: id, group, color: '', sequence }
}

const STATES = [
  state('Done', 'completed'),
  state('In Review', 'started', 2),
  state('Doing', 'started', 1),
  state('Todo', 'unstarted'),
  state('Backlog', 'backlog'),
  state("Won't do", 'cancelled')
]

const ITEM: PlaneWorkItem = {
  connectionId: 'conn-1',
  id: 'item-1',
  projectId: 'project-1',
  projectIdentifier: 'WEB',
  sequenceId: 12,
  identifier: 'WEB-12',
  name: 'Fix login redirect',
  state: STATES[3],
  priority: 'none',
  assignees: [],
  labels: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
  url: 'https://app.plane.so/acme/projects/project-1/issues/item-1'
}

beforeEach(() => {
  mocks.listStates.mockReset().mockResolvedValue({ ok: true, value: STATES })
  mocks.updateState.mockReset()
  mocks.toastError.mockReset()
})
afterEach(cleanup)

describe('groupPlaneStates', () => {
  it('orders sections Backlog, Unstarted, Started, Completed, Cancelled and sorts by sequence', () => {
    const sections = groupPlaneStates(STATES)
    expect(sections.map((section) => section.label)).toEqual([
      'Backlog',
      'Unstarted',
      'Started',
      'Completed',
      'Cancelled'
    ])
    expect(sections[2].states.map((entry) => entry.name)).toEqual(['Doing', 'In Review'])
  })

  it('adds Triage only when the project has triage states', () => {
    expect(groupPlaneStates([...STATES, state('Inbox', 'triage')]).at(-1)?.label).toBe('Triage')
  })
})

describe('usePlaneStateChange', () => {
  function setup() {
    const onItemChange = vi.fn()
    const view = renderHook(() => usePlaneStateChange({ item: ITEM, target: TARGET, onItemChange }))
    return { onItemChange, view }
  }

  it('applies the new state at once, then settles on the host answer', async () => {
    const saved = { ...ITEM, state: STATES[2], updatedAt: '2026-01-03T00:00:00Z' }
    mocks.updateState.mockResolvedValue({ ok: true, value: saved })
    const { onItemChange, view } = setup()

    await act(async () => view.result.current.changeState(STATES[2]))

    expect(onItemChange).toHaveBeenNthCalledWith(1, { ...ITEM, state: STATES[2] })
    expect(onItemChange).toHaveBeenLastCalledWith(saved)
    expect(mocks.updateState).toHaveBeenCalledWith(TARGET, {
      projectId: 'project-1',
      workItemId: 'item-1',
      stateId: 'Doing'
    })
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('rolls back and explains a 403 without retrying', async () => {
    mocks.updateState.mockResolvedValue({ ok: false, error: { kind: 'forbidden', message: 'x' } })
    const { onItemChange, view } = setup()

    await act(async () => view.result.current.changeState(STATES[0]))

    expect(onItemChange).toHaveBeenLastCalledWith(ITEM)
    expect(mocks.toastError).toHaveBeenCalledWith(
      "You don't have permission to change this work item in Plane."
    )
    expect(mocks.updateState).toHaveBeenCalledOnce()
  })

  it('rolls back when the host cannot be reached', async () => {
    mocks.updateState.mockRejectedValue(new Error('socket closed'))
    const { onItemChange, view } = setup()

    await act(async () => view.result.current.changeState(STATES[0]))

    expect(onItemChange).toHaveBeenLastCalledWith(ITEM)
    expect(mocks.toastError).toHaveBeenCalledOnce()
  })

  it('ignores a second pick while one is in flight and the current state', async () => {
    mocks.updateState.mockReturnValue(new Promise(() => {}))
    const { view } = setup()

    act(() => {
      view.result.current.changeState(ITEM.state ?? STATES[0])
      view.result.current.changeState(STATES[0])
      view.result.current.changeState(STATES[1])
    })

    expect(mocks.updateState).toHaveBeenCalledOnce()
    expect(view.result.current.pending).toBe(true)
  })
})

describe('PlaneStatePicker', () => {
  it('lists the project states in grouped sections and applies a pick', async () => {
    mocks.updateState.mockResolvedValue({ ok: true, value: { ...ITEM, state: STATES[0] } })
    const onItemChange = vi.fn()
    render(<PlaneStatePicker item={ITEM} target={TARGET} onItemChange={onItemChange} />)

    const trigger = screen.getByRole('button', { name: 'Change state: Todo' })
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' })
    await waitFor(() => expect(screen.getByRole('group', { name: 'Started' })).toBeTruthy())
    expect(screen.getByRole('group', { name: 'Completed' })).toBeTruthy()
    expect(mocks.listStates).toHaveBeenCalledWith(TARGET, 'project-1')

    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Done' }))
    await waitFor(() =>
      expect(onItemChange).toHaveBeenLastCalledWith({ ...ITEM, state: STATES[0] })
    )
  })
})
