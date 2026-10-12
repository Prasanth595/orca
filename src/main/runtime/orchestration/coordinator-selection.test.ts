import { expect, it } from 'vitest'
import { OrchestrationDb } from './db'
import { selectOrchestrationPointerBatch } from './mailbox-pointer-eligibility'
import { assertCoordinatorPassOwner } from './coordinator-pass'

it('treats a rejected heartbeat as actionable while leaving ordinary liveness quiet', () => {
  const db = new OrchestrationDb(':memory:')
  try {
    const run = db.createRun({
      objective: 'Hub',
      coordinatorHandle: 'hub',
      coordinatorPaneKey: 'pane',
      notificationPolicy: 'coordination'
    })
    const mailboxHandle = `run:${run.id}`
    const ordinary = db.insertMessage({
      from: 'worker',
      to: mailboxHandle,
      runId: run.id,
      type: 'heartbeat',
      subject: 'Alive'
    })
    const rejected = db.insertMessage({
      from: 'wrong-worker',
      to: mailboxHandle,
      runId: run.id,
      type: 'heartbeat',
      subject: 'Alive'
    })
    db.convertLifecycleMessageToRejection(
      rejected.id,
      'dispatch_fenced',
      'The assignee did not send this heartbeat.'
    )
    expect(
      selectOrchestrationPointerBatch({
        db,
        mailboxHandle,
        waiters: undefined,
        reservedTypes: undefined
      }).map((row) => row.id)
    ).toEqual([rejected.id])
    expect(db.getMessageById(ordinary.id)?.read).toBe(0)
  } finally {
    db.close()
  }
})

it('filters routine rows before the batch limit while preserving generic Run notifications', () => {
  const db = new OrchestrationDb(':memory:')
  try {
    const run = db.createRun({
      objective: 'Hub',
      coordinatorHandle: 'hub',
      coordinatorPaneKey: 'pane',
      notificationPolicy: 'coordination'
    })
    const mailboxHandle = `run:${run.id}`
    for (let i = 0; i < 60; i++) {
      db.insertMessage({
        from: 'worker',
        to: mailboxHandle,
        runId: run.id,
        type: 'status',
        subject: 'Routine',
        payload: 'malformed'
      })
    }
    const ids = ['worker_done', 'escalation', 'question', 'status'].map(
      (type) =>
        db.insertMessage({
          from: 'worker',
          to: mailboxHandle,
          runId: run.id,
          subject: 'Material',
          type:
            type === 'worker_done'
              ? 'worker_done'
              : type === 'escalation'
                ? 'escalation'
                : type === 'question'
                  ? 'question'
                  : 'status',
          payload: JSON.stringify({ materialKind: 'dependency-change' })
        }).id
    )
    expect(
      selectOrchestrationPointerBatch({
        db,
        mailboxHandle,
        waiters: undefined,
        reservedTypes: undefined
      }).map((row) => row.id)
    ).toEqual(ids)
    expect(db.getUnreadMessages(mailboxHandle)).toHaveLength(64)
    const generic = db.createRun({
      objective: 'Generic',
      coordinatorHandle: 'other',
      coordinatorPaneKey: 'other-pane'
    })
    const row = db.insertMessage({
      from: 'worker',
      to: `run:${generic.id}`,
      runId: generic.id,
      type: 'heartbeat',
      subject: 'Routine'
    })
    expect(
      selectOrchestrationPointerBatch({
        db,
        mailboxHandle: `run:${generic.id}`,
        waiters: undefined,
        reservedTypes: undefined
      }).map((message) => message.id)
    ).toEqual([row.id])
  } finally {
    db.close()
  }
})

it('fences timer callers without taking over a Run or inferring death from missing contact', () => {
  const db = new OrchestrationDb(':memory:')
  try {
    const run = db.createRun({
      objective: 'Hub',
      coordinatorHandle: 'hub',
      coordinatorPaneKey: 'pane',
      notificationPolicy: 'coordination'
    })
    const input = {
      db,
      runId: run.id,
      to: `run:${run.id}`,
      type: 'status',
      owner: {
        handle: 'hub',
        consumerGeneration: run.consumer_generation,
        processIncarnation: 'inc'
      },
      readProcessIncarnation: () => 'inc'
    }
    expect(() => assertCoordinatorPassOwner(input)).not.toThrow()
    expect(() =>
      assertCoordinatorPassOwner({ ...input, readProcessIncarnation: () => null })
    ).toThrow('cannot be verified')
    expect(() =>
      assertCoordinatorPassOwner({ ...input, owner: { ...input.owner, consumerGeneration: 0 } })
    ).toThrow('not current')
    expect(() =>
      assertCoordinatorPassOwner({ ...input, readProcessIncarnation: () => 'replacement' })
    ).toThrow('process changed')
    expect(() =>
      assertCoordinatorPassOwner({
        ...input,
        readProcessIncarnation: () => {
          throw new Error('disconnected')
        }
      })
    ).toThrow('not addressable')
    db.createRun({ objective: 'New owner', coordinatorHandle: 'hub', coordinatorPaneKey: 'pane' })
    expect(() => assertCoordinatorPassOwner(input)).toThrow('not current')
    expect(db.getRun(run.id)?.consumer_generation).toBeGreaterThan(run.consumer_generation)
  } finally {
    db.close()
  }
})
