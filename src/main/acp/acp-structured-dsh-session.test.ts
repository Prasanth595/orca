import { afterEach, describe, expect, it } from 'vitest'
import { readAgentJournalTurn } from '../../shared/agent-session-turn-record'
import {
  closeProviderTimelineRigs,
  messageText,
  SESSION
} from '../native-chat/agent-session-timeline/provider-timeline-assembler-test-support'
import { PROVIDER_SESSION, sendHello, waitFor } from './acp-structured-adapter.test-support'
import {
  DSH_CONFIG,
  dshUpdate,
  installDshOptionWrites,
  MODEL,
  openDshRig
} from './acp-structured-dsh.test-support'

afterEach(closeProviderTimelineRigs)

describe('DSH sessions through the generic ACP adapter', () => {
  it('creates a session and reads only its advertised opaque model and effort values', async () => {
    const rig = await openDshRig({ script: installDshOptionWrites })
    const acquired = await rig.acquire()
    expect(acquired.link).toMatchObject({
      origin: 'created',
      handle: { transport: 'acp', agent: 'dsh', nativeId: PROVIDER_SESSION }
    })
    expect(rig.sent('session/new')[0]?.params).toEqual({
      cwd: '/workspace/project',
      mcpServers: []
    })
    expect(rig.sent('authenticate')).toEqual([])
    expect(rig.adapter.readCommands(SESSION)).toBeUndefined()
    const options = await rig.adapter.readOptions({ sessionId: SESSION, fence: 1 })
    expect(options.current).toMatchObject({ model: MODEL, effort: 'high' })
    expect(options.models[0]?.efforts).toEqual([
      { value: '', label: 'Provider default' },
      { value: 'high', label: 'High' }
    ])
    await rig.adapter.setOption({ sessionId: SESSION, key: 'effort', value: '', fence: 1 })
    await rig.adapter.setOption({
      sessionId: SESSION,
      key: 'model',
      value: 'opaque-provider-model-b',
      fence: 1
    })
    expect(rig.sent('session/set_config_option').map((frame) => frame.params)).toEqual([
      { sessionId: PROVIDER_SESSION, configId: 'reasoning_effort', value: '' },
      { sessionId: PROVIDER_SESSION, configId: 'model', value: 'opaque-provider-model-b' }
    ])
    expect((await rig.adapter.readOptions({ sessionId: SESSION, fence: 1 })).current).toMatchObject(
      {
        model: 'opaque-provider-model-b',
        effort: ''
      }
    )
    await rig.adapter.closeSession(SESSION)
  })

  it('resumes without session/load or transcript replay and keeps the Orca journal', async () => {
    const rig = await openDshRig({ resume: true })
    const acquired = await rig.acquire()
    expect(acquired.link).toMatchObject({
      origin: 'resumed',
      handle: { nativeId: PROVIDER_SESSION }
    })
    expect(rig.sent('session/resume')[0]?.params).toEqual({
      cwd: '/workspace/project',
      mcpServers: [],
      sessionId: PROVIDER_SESSION
    })
    expect(rig.sent('session/load')).toEqual([])
    expect(rig.sent('session/new')).toEqual([])
    await sendHello(rig, 'first')
    const prompt = await rig.frame('session/prompt')
    rig.child().agent.notify(
      'session/update',
      dshUpdate({
        sessionUpdate: 'agent_message_chunk',
        messageId: 'reply-1',
        content: { type: 'text', text: 'saved answer' }
      })
    )
    rig.child().agent.reply(prompt, { stopReason: 'end_turn' })
    await rig.settle()
    const before = await rig.rig.rows()
    await rig.adapter.closeSession(SESSION)
    await rig.acquire({ fence: 2 })
    await rig.settle()
    expect(await rig.rig.rows()).toEqual(before)
    const reopened = await rig.rig.reopenJournal()
    expect(reopened.snapshot().items.filter((row) => row.body.kind === 'message')).toEqual(
      before.filter((row) => row.body.kind === 'message')
    )
    await rig.adapter.closeSession(SESSION)
  })

  it.each([false, true])(
    'restores saved model and provider-default effort (resume: %s)',
    async (resume) => {
      const rig = await openDshRig({ resume, script: installDshOptionWrites })
      await rig.adapter.acquire({
        identity: {
          sessionId: SESSION,
          workspaceId: 'workspace-1',
          hostId: 'local',
          agent: 'dsh',
          providerHandle: null
        },
        fence: 1,
        spawnToken: 'restored-options',
        events: rig.rig.eventSink,
        options: { model: 'opaque-provider-model-b', effort: '' }
      })
      expect(
        (await rig.adapter.readOptions({ sessionId: SESSION, fence: 1 })).current
      ).toMatchObject({
        model: 'opaque-provider-model-b',
        effort: ''
      })
      expect(rig.sent('session/set_config_option').map((frame) => frame.params)).toEqual([
        { sessionId: PROVIDER_SESSION, configId: 'model', value: 'opaque-provider-model-b' },
        { sessionId: PROVIDER_SESSION, configId: 'reasoning_effort', value: '' }
      ])
      await rig.adapter.closeSession(SESSION)
    }
  )

  it('warns and starts a new context when DSH refuses a saved session', async () => {
    const rig = await openDshRig({
      resume: true,
      script: (agent) =>
        agent.on('session/resume', (frame) =>
          agent.fail(frame, -32602, 'Invalid params', 'session is not resumable: saved')
        )
    })
    expect((await rig.acquire()).link).toMatchObject({
      origin: 'created',
      replaces: { key: 'saved-dsh-key', reason: 'restore-failed' }
    })
    expect(rig.sent('session/new')).toHaveLength(1)
    expect((await rig.rig.rows()).map((row) => row.body)).toContainEqual(
      expect.objectContaining({
        kind: 'status',
        tone: 'warning',
        failure: expect.objectContaining({ kind: 'sessionNotRestored' })
      })
    )
    await sendHello(rig, 'recovered')
    const prompt = await rig.frame('session/prompt')
    rig.child().agent.notify(
      'session/update',
      dshUpdate({
        sessionUpdate: 'agent_message_chunk',
        messageId: 'reply-2',
        content: { type: 'text', text: 'works again' }
      })
    )
    rig.child().agent.reply(prompt, { stopReason: 'end_turn' })
    await waitFor(async () =>
      expect((await rig.rig.rows()).map((row) => messageText(row.body))).toContain('works again')
    )
    await rig.adapter.closeSession(SESSION)
  })

  it('contains a failed prompt and accepts the next one', async () => {
    const rig = await openDshRig()
    await rig.acquire()
    await sendHello(rig, 'failed')
    const prompt = await rig.frame('session/prompt')
    rig.child().agent.notify(
      'session/update',
      dshUpdate({
        sessionUpdate: 'agent_thought_chunk',
        messageId: 'failed-reply',
        content: { type: 'text', text: 'thinking' }
      })
    )
    rig.child().agent.fail(prompt, -32603, 'Internal error', 'DSH model route unavailable')
    await rig.settle()
    expect((await rig.rig.rows()).map((row) => row.body)).toContainEqual(
      expect.objectContaining({
        kind: 'status',
        tone: 'error',
        text: 'DSH model route unavailable'
      })
    )
    await sendHello(rig, 'retry')
    rig.child().agent.reply(await rig.frame('session/prompt', 1), { stopReason: 'end_turn' })
    await rig.settle()
    expect(
      (await rig.rig.rows()).flatMap((row) => readAgentJournalTurn(row.body) ?? []).at(-1)
    ).toMatchObject({ state: 'completed', outcome: 'success' })
    await rig.adapter.closeSession(SESSION)
  })

  it('closes a failed startup and can acquire again', async () => {
    let attempts = 0
    const rig = await openDshRig({
      script: (agent) =>
        agent.on('session/new', (frame) => {
          attempts += 1
          if (attempts === 1) {
            agent.fail(frame, -32603, 'Invalid DSH configuration')
          } else {
            agent.reply(frame, { sessionId: PROVIDER_SESSION, configOptions: DSH_CONFIG })
          }
        })
    })
    await expect(rig.acquire()).rejects.toThrow('Invalid DSH configuration')
    expect(rig.child().closes).toBe(1)
    await expect(rig.acquire({ fence: 2 })).resolves.toMatchObject({
      link: { handle: { agent: 'dsh' } }
    })
    await rig.adapter.closeSession(SESSION)
  })
})
