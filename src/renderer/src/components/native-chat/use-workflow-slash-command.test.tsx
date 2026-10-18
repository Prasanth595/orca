/** @vitest-environment happy-dom */
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentWorkflow } from '../../../../shared/workflow-types'
import { useWorkflowSlashCommand } from './use-workflow-slash-command'

const navigation = vi.hoisted(() => ({
  setSelectedWorkflowId: vi.fn(),
  openWorkflowsPage: vi.fn()
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('../../store', () => ({
  useAppStore: (selector: (state: unknown) => unknown) =>
    selector({
      setSelectedWorkflowId: navigation.setSelectedWorkflowId,
      openWorkflowsPage: navigation.openWorkflowsPage
    })
}))

type ChangeListener = (payload: { workflows: AgentWorkflow[] }) => void

function workflowsHarness(workflows: AgentWorkflow[]) {
  const listeners: ChangeListener[] = [] // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: harness stub; the hook only calls list/onChanged.
  Object.assign(window, {
    api: {
      workflows: {
        list: vi.fn(async () => workflows),
        onChanged: (listener: ChangeListener) => {
          listeners.push(listener)
          return () => {
            const at = listeners.indexOf(listener)
            if (at !== -1) {
              listeners.splice(at, 1)
            }
          }
        }
      }
    }
  })
  return {
    emit: (workflows: AgentWorkflow[]) => {
      for (const listener of listeners.slice()) {
        listener({ workflows })
      }
    },
    listenerCount: () => listeners.length
  }
}

function workflow(id: string, name = 'Disk space report'): AgentWorkflow {
  return {
    id,
    name,
    description: '',
    schedule: null,
    enabled: false,
    executionTargetType: 'local',
    executionTargetId: 'local',
    nodes: [],
    edges: [],
    createdAt: Date.now() - 60_000,
    updatedAt: Date.now() - 60_000
  }
}

function created(id: string): AgentWorkflow {
  return { ...workflow(id), createdAt: Date.now() + 60_000 }
}

afterEach(() => {
  vi.useRealTimers()
  navigation.setSelectedWorkflowId.mockClear()
  navigation.openWorkflowsPage.mockClear()
})

describe('useWorkflowSlashCommand', () => {
  it('opens the Workflows page on the graph the agent created after the route', () => {
    const harness = workflowsHarness([workflow('existing')])
    const { result } = renderHook(() => useWorkflowSlashCommand())
    vi.useFakeTimers()

    result.current('check disk space')
    harness.emit([workflow('existing'), created('wf-new')])

    expect(navigation.setSelectedWorkflowId).toHaveBeenCalledWith('wf-new')
    expect(navigation.openWorkflowsPage).toHaveBeenCalledOnce()
    expect(harness.listenerCount()).toBe(0)
  })

  it('keeps watching until the agent reports a creation, then stops on the timeout', () => {
    const harness = workflowsHarness([workflow('existing')])
    vi.useFakeTimers()
    const { result } = renderHook(() => useWorkflowSlashCommand())

    result.current(null)
    harness.emit([workflow('existing')]) // unrelated update
    expect(navigation.openWorkflowsPage).not.toHaveBeenCalled()
    expect(harness.listenerCount()).toBe(1)

    vi.advanceTimersByTime(10 * 60 * 1000)
    expect(harness.listenerCount()).toBe(0)
    expect(navigation.openWorkflowsPage).not.toHaveBeenCalled()
  })

  it('a newer route supersedes the in-flight watch', () => {
    const harness = workflowsHarness([workflow('existing')])
    const { result } = renderHook(() => useWorkflowSlashCommand())
    vi.useFakeTimers()

    result.current('first idea')
    expect(harness.listenerCount()).toBe(1)
    result.current('better idea')
    expect(harness.listenerCount()).toBe(1)

    harness.emit([workflow('existing'), created('wf-second')])
    expect(navigation.setSelectedWorkflowId).toHaveBeenCalledWith('wf-second')
    expect(navigation.openWorkflowsPage).toHaveBeenCalledOnce()
    expect(harness.listenerCount()).toBe(0)
  })
})
