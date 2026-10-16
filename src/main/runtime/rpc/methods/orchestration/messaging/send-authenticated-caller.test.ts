import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { RpcContext } from '../../../core'
import {
  createRootDispatch,
  reattachDispatchConsumer
} from '../../../../orchestration/db/root-dispatch-test-fixture'
import { createOrchestrationRpcHarness } from '../rpc-test-harness'

describe('orchestration.send authenticated lifecycle caller', () => {
  const harness = createOrchestrationRpcHarness()
  afterEach(() => harness.cleanup())

  it('rejects nested replay without settling or revoking the outer worker', async () => {
    const { db, runtime, activeRunId } = harness.setup()
    const task = db.createTask({ spec: 'outer work remains active' })
    const dispatch = createRootDispatch(db, task.id, 'term_outer', 'tab_outer:leaf_outer')
    const payload = JSON.stringify({
      taskId: task.id,
      dispatchId: dispatch.id,
      outcome: 'succeeded'
    })
    const call = (ctx: RpcContext) =>
      harness.call(
        'orchestration.send',
        { from: 'term_outer', subject: 'Done', type: 'worker_done', payload },
        ctx
      )
    const context = (
      terminalHandle: string,
      paneKey: string,
      processIncarnation = `runtime_test:${terminalHandle}:1`
    ): RpcContext => ({
      runtime,
      orchestrationCompatibilityCallerAuthority: {
        hostScope: { kind: 'local', hostId: 'local' },
        terminalHandle,
        paneKey,
        processIncarnation,
        launchTokenHash: 'launch-token-hash'
      }
    })

    await expect(call(context('term_nested', 'tab_nested:leaf_nested'))).rejects.toMatchObject({
      code: 'sender_not_assignee'
    })
    expect(db.getTask(task.id)?.status).toBe('dispatched')
    expect(db.getDispatchContextById(dispatch.id)).toMatchObject({
      status: 'dispatched',
      capability_revoked_at: null
    })
    expect(db.getUnreadMessages(`run:${activeRunId}`)).toHaveLength(0)

    reattachDispatchConsumer(db, {
      dispatchId: dispatch.id,
      paneKey: 'tab_outer:leaf_outer',
      processIncarnation: 'runtime_test:term_outer:2'
    })
    await expect(call(context('term_outer', 'tab_outer:leaf_outer'))).resolves.toMatchObject({
      lifecycle: { action: 'rejected', code: 'worker_identity_changed' }
    })
    expect(db.getTask(task.id)?.status).toBe('dispatched')
    expect(db.getDispatchContextById(dispatch.id)).toMatchObject({
      status: 'dispatched',
      capability_revoked_at: null
    })

    const currentContext = context(
      'term_outer',
      'tab_outer:leaf_outer',
      'runtime_test:term_outer:2'
    )
    const accepted = z
      .object({
        message: z.object({ payload: z.string() }),
        lifecycle: z.object({ action: z.string() })
      })
      .parse(await call(currentContext))
    expect(accepted.lifecycle.action).toBe('completed')
    expect(JSON.parse(accepted.message.payload)).toMatchObject({
      providerSenderAttestation: {
        version: 1,
        dispatchId: dispatch.id,
        taskId: task.id,
        terminalHandle: 'term_outer',
        paneKey: 'tab_outer:leaf_outer',
        processIncarnation: 'runtime_test:term_outer:2',
        consumerGeneration: 1
      }
    })
  })
})
