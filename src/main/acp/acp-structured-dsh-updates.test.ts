import { afterEach, describe, expect, it } from 'vitest'
import { readAgentJournalTurn } from '../../shared/agent-session-turn-record'
import {
  closeProviderTimelineRigs,
  SESSION
} from '../native-chat/agent-session-timeline/provider-timeline-assembler-test-support'
import { sendHello, waitFor } from './acp-structured-adapter.test-support'
import { DSH_PERMISSION, dshUpdate, openDshRig } from './acp-structured-dsh.test-support'

afterEach(closeProviderTimelineRigs)

describe('DSH semantic updates and permissions', () => {
  it('reports a lost process and permits a new acquisition', async () => {
    const rig = await openDshRig()
    await rig.acquire()
    await sendHello(rig, 'first')
    await rig.frame('session/prompt')
    rig.child().exit()
    await waitFor(() =>
      expect(rig.lifecycle).toMatchObject([
        { type: 'ended', cause: 'unexpected-exit', failure: { kind: 'providerExited' } }
      ])
    )
    await expect(rig.acquire({ fence: 2 })).resolves.toMatchObject({
      link: { handle: { agent: 'dsh' } }
    })
    await rig.adapter.closeSession(SESSION)
  })

  it.each(['completed', 'failed'])(
    'renders thought, assistant, and a %s generic tool',
    async (status) => {
      const rig = await openDshRig()
      await rig.acquire()
      await sendHello(rig, 'first')
      const prompt = await rig.frame('session/prompt')
      const agent = rig.child().agent
      for (const update of [
        {
          sessionUpdate: 'agent_thought_chunk',
          messageId: 'message-1',
          content: { type: 'text', text: 'Check the source.' }
        },
        {
          sessionUpdate: 'agent_message_chunk',
          messageId: 'message-1',
          content: { type: 'text', text: 'Reading the file.' }
        },
        {
          sessionUpdate: 'tool_call',
          toolCallId: 'call-1',
          title: 'read_file',
          kind: 'other',
          status: 'in_progress',
          rawInput: { path: 'README.md' }
        },
        {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'call-1',
          status,
          content: [{ type: 'content', content: { type: 'text', text: 'tool result' } }]
        },
        { sessionUpdate: 'usage_update', used: 200, size: 10000 }
      ]) {
        agent.notify('session/update', dshUpdate(update))
      }
      agent.reply(prompt, { stopReason: 'end_turn' })
      await rig.settle()
      const bodies = (await rig.rig.rows()).map((row) => row.body)
      expect(bodies.filter((body) => body.kind === 'message')).toMatchObject([
        { role: 'reasoning', blocks: [{ text: 'Check the source.' }] },
        { role: 'assistant', blocks: [{ text: 'Reading the file.' }] }
      ])
      expect(bodies.find((body) => body.kind === 'tool-call')).toMatchObject({
        callId: 'call-1',
        name: 'read_file',
        input: { path: 'README.md' },
        state: status,
        output: { head: 'tool result' }
      })
      expect(bodies.flatMap((body) => readAgentJournalTurn(body) ?? [])).toMatchObject([
        { state: 'completed', outcome: 'success', contextUsage: { window: { tokens: 10000 } } }
      ])
      await rig.adapter.closeSession(SESSION)
    }
  )

  it.each(['allow-once', 'reject-once'])(
    'commits %s before answering the permission request',
    async (optionId) => {
      const rig = await openDshRig()
      await rig.acquire()
      await sendHello(rig, 'first')
      const prompt = await rig.frame('session/prompt')
      const reply = rig.child().agent.request(7, 'session/request_permission', DSH_PERMISSION)
      const row = await waitFor(async () => {
        const found = (await rig.rig.rows()).find((item) => item.body.kind === 'approval')
        if (!found) {
          throw new Error('permission has not arrived')
        }
        return found
      })
      let committed = false
      await rig.adapter.answerPrompt({
        sessionId: SESSION,
        itemId: row.itemId,
        kind: 'approval',
        response: { kind: 'option', optionId },
        fence: 1,
        commit: async () => {
          committed = true
        }
      })
      expect(committed).toBe(true)
      expect(await reply).toMatchObject({ result: { outcome: { outcome: 'selected', optionId } } })
      rig.child().agent.reply(prompt, { stopReason: 'end_turn' })
      await rig.settle()
      await rig.adapter.closeSession(SESSION)
    }
  )

  it('automatically allows the one-shot request only when full access is enabled', async () => {
    const rig = await openDshRig({ fullAccess: true })
    await rig.acquire()
    await sendHello(rig, 'first')
    const prompt = await rig.frame('session/prompt')
    const reply = await rig.child().agent.request(8, 'session/request_permission', DSH_PERMISSION)
    expect(reply).toMatchObject({
      result: { outcome: { outcome: 'selected', optionId: 'allow-once' } }
    })
    expect((await rig.rig.rows()).some((row) => row.body.kind === 'approval')).toBe(false)
    rig.child().agent.reply(prompt, { stopReason: 'end_turn' })
    await rig.settle()
    await rig.adapter.closeSession(SESSION)
  })

  it('cancels the running prompt and pending permission, then accepts another prompt', async () => {
    const rig = await openDshRig()
    await rig.acquire()
    await sendHello(rig, 'first')
    const prompt = await rig.frame('session/prompt')
    const agent = rig.child().agent
    const reply = agent.request(9, 'session/request_permission', DSH_PERMISSION)
    await waitFor(async () =>
      expect((await rig.rig.rows()).some((row) => row.body.kind === 'approval')).toBe(true)
    )
    agent.on('session/cancel', () => agent.reply(prompt, { stopReason: 'cancelled' }))
    await expect(rig.adapter.cancelTurn({ sessionId: SESSION, fence: 1 })).resolves.toEqual({
      cancelled: true
    })
    expect(await reply).toMatchObject({ result: { outcome: { outcome: 'cancelled' } } })
    expect(rig.sent('session/cancel')[0]?.params).toEqual({ sessionId: DSH_PERMISSION.sessionId })
    await rig.settle()
    expect(
      (await rig.rig.rows()).flatMap((row) => readAgentJournalTurn(row.body) ?? []).at(-1)
    ).toMatchObject({ state: 'interrupted', outcome: 'cancellation' })
    await sendHello(rig, 'second')
    agent.reply(await rig.frame('session/prompt', 1), { stopReason: 'end_turn' })
    await rig.settle()
    await rig.adapter.closeSession(SESSION)
  })
})
