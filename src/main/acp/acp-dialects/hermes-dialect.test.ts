import { describe, expect, it } from 'vitest'
import type { AgentJournalToolCallItem } from '../../../shared/agent-session-journal-types'
import type { ToolCallUpdate } from '../generated/acp-protocol.generated'
import { hermesToolBackgroundTasks, hermesToolSubagents } from './hermes-dialect'

function update(fields: Partial<ToolCallUpdate> & { toolCallId: string }): ToolCallUpdate {
  return fields as ToolCallUpdate
}

function call(
  name: string,
  input: unknown,
  state: AgentJournalToolCallItem['state'] = 'running'
): AgentJournalToolCallItem {
  return { kind: 'tool-call', name, input, state }
}

describe('hermes dialect', () => {
  it('reads a delegate_task call as one working subagent named by its goal', () => {
    expect(
      hermesToolSubagents(
        update({ toolCallId: 'call-1', status: 'in_progress', title: 'Check the logs' }),
        call('delegate_task', { goal: 'Check the logs' })
      )
    ).toEqual([{ id: 'call-1', state: 'working', label: 'Check the logs' }])
  })

  it('reads the name off the title Hermes builds, `name: detail`', () => {
    expect(
      hermesToolSubagents(
        update({ toolCallId: 'call-9', status: 'in_progress', title: 'delegate_task: 1 tasks: PONG' }),
        call('delegate_task: 1 tasks: Reply with PONG', { goal: 'Reply with PONG' })
      )
    ).toEqual([{ id: 'call-9', state: 'working', label: 'delegate_task: 1 tasks: PONG' }])
  })

  it('reads a batch spawn as one subagent per goal and a finish as the call reply', () => {
    const spawned = hermesToolSubagents(
      update({ toolCallId: 'call-2', status: 'in_progress', title: 'Two jobs' }),
      call('delegate_task', { tasks: [{ goal: 'First' }, { goal: 'Second' }] })
    )
    expect(spawned.map((entry) => entry.id)).toEqual(['call-2:0', 'call-2:1'])

    expect(
      hermesToolSubagents(
        update({
          toolCallId: 'call-2',
          status: 'completed',
          title: 'Two jobs',
          content: [{ type: 'content', content: { type: 'text', text: 'Both done' } }]
        }),
        call('delegate_task', { goal: 'One job' })
      )
    ).toEqual([{ id: 'call-2', state: 'completed', label: 'Two jobs', result: 'Both done' }])
  })

  it('ignores every other tool, and a subagent whose status is unknown', () => {
    expect(hermesToolSubagents(update({ toolCallId: 'c', status: 'in_progress' }), call('terminal', {}))).toEqual([])
    expect(hermesToolSubagents(update({ toolCallId: 'c', status: null }), call('delegate_task', {}))).toEqual([])
  })

  it('reads a backgrounded terminal call as a running task, and a kill as done', () => {
    expect(
      hermesToolBackgroundTasks(
        update({ toolCallId: 'call-3', status: 'completed', title: 'npm run dev' }),
        call('terminal', { command: 'npm run dev', background: true })
      )
    ).toEqual([
      {
        taskId: 'call-3',
        kind: 'command',
        label: 'npm run dev',
        state: 'working',
        parentToolUseId: 'call-3'
      }
    ])

    expect(
      hermesToolBackgroundTasks(
        update({ toolCallId: 'call-4', status: 'completed', title: 'kill' }),
        call('process', { action: 'kill' })
      )
    ).toEqual([{ taskId: 'call-4', kind: 'command', label: 'kill', state: 'done' }])
  })

  it('leaves a foreground command alone', () => {
    expect(
      hermesToolBackgroundTasks(
        update({ toolCallId: 'call-5', status: 'completed' }),
        call('terminal', { command: 'ls' })
      )
    ).toEqual([])
  })
})
