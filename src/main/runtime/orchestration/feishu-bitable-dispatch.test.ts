import { describe, expect, it, vi } from 'vitest'
import {
  dispatchFeishuBitableTask,
  type FeishuBitableDispatchRequest
} from './feishu-bitable-dispatch'

function request(): FeishuBitableDispatchRequest {
  return {
    input: {
      task: {
        source: { connectionId: 'c', appToken: 'a', tableId: 't', recordId: 'r' },
        title: 'Task',
        description: 'Do the work'
      },
      userInstruction: 'Implement and test'
    },
    from: 'session:caller',
    agent: 'codex',
    placement: { kind: 'existing', worktree: 'id:folder-workspace', on: 'ssh:chosen-host' }
  }
}

describe('dispatchFeishuBitableTask', () => {
  it('passes explicit existing folder/remote placement and returns the unmodified receipt', async () => {
    const receipt = { dispatchId: 'd', state: 'idle' }
    const dispatch = vi.fn().mockResolvedValue(receipt)
    const result = await dispatchFeishuBitableTask(request(), dispatch)
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith({
      from: 'session:caller',
      agent: 'codex',
      worktree: 'id:folder-workspace',
      on: 'ssh:chosen-host',
      spec: result.plan.taskSpec
    })
    expect(result.receipt).toBe(receipt)
    expect(result).not.toHaveProperty('completed')
  })

  it.each(['new-child', 'new-top-level'] as const)(
    'delegates %s creation to the injected worker start',
    async (worktree) => {
      const fixture = request()
      fixture.placement = {
        kind: 'new',
        worktree,
        repo: 'id:repo',
        baseBranch: 'main',
        setup: 'skip'
      }
      fixture.model = 'chosen-model'
      fixture.effort = 'high'
      const dispatch = vi.fn().mockResolvedValue({ accepted: true })
      const result = await dispatchFeishuBitableTask(fixture, dispatch)
      expect(dispatch).toHaveBeenCalledWith({
        from: fixture.from,
        agent: 'codex',
        worktree,
        repo: 'id:repo',
        baseBranch: 'main',
        setup: 'skip',
        model: 'chosen-model',
        effort: 'high',
        name: result.plan.suggestedWorkspaceName,
        spec: result.plan.taskSpec
      })
    }
  )

  it('propagates dispatch failure without retries or status inference', async () => {
    const failure = new Error('host unreachable')
    const dispatch = vi.fn().mockRejectedValue(failure)
    await expect(dispatchFeishuBitableTask(request(), dispatch)).rejects.toBe(failure)
    expect(dispatch).toHaveBeenCalledTimes(1)
  })

  it.each(['current', 'new-child', 'new-top-level', '', ' current ', '\u001bhost'])(
    'rejects ambiguous or unsafe placement %j before dispatch',
    async (worktree) => {
      const fixture = request()
      fixture.placement = { kind: 'existing', worktree }
      const dispatch = vi.fn()
      await expect(dispatchFeishuBitableTask(fixture, dispatch)).rejects.toThrow()
      expect(dispatch).not.toHaveBeenCalled()
    }
  )

  it('validates input before any effects', async () => {
    const fixture = request()
    fixture.input.task.source.recordId = ''
    const dispatch = vi.fn()
    await expect(dispatchFeishuBitableTask(fixture, dispatch)).rejects.toThrow('identity')
    expect(dispatch).not.toHaveBeenCalled()
  })
})
