import { describe, expect, it } from 'vitest'
import type { AgentJournalToolCallItem } from '../../../shared/agent-session-journal-types'
import type { ToolCallUpdate } from '../generated/acp-protocol.generated'
import { hermesToolBackgroundTasks, hermesToolSubagents } from './hermes-dialect'

/** The text blocks Hermes sends, wrapped the way ACP wraps them. */
function text(...texts: string[]): ToolCallUpdate['content'] {
  return texts.map((value) => ({ type: 'content', content: { type: 'text', text: value } })) as
    ToolCallUpdate['content']
}

function update(fields: Partial<ToolCallUpdate> & { toolCallId: string }): ToolCallUpdate {
  return fields as ToolCallUpdate
}

function call(
  name: string,
  input: unknown = null,
  state: AgentJournalToolCallItem['state'] = 'running'
): AgentJournalToolCallItem {
  return { kind: 'tool-call', name, input, state }
}

describe('hermes dialect', () => {
  it('reads the name off the title Hermes builds, `name: detail`', () => {
    expect(
      hermesToolSubagents(
        update({ toolCallId: 'tc-1', status: 'completed', title: 'delegate_task: 1 tasks: PONG' }),
        call('delegate_task: 1 tasks: Reply with PONG')
      )
    ).toEqual([{ id: 'tc-1', state: 'completed', label: 'delegate_task: 1 tasks: PONG' }])
  })

  // Captured from Hermes: the call answers with the delegation it dispatched, whose children keep
  // running after the call itself completed.
  it('reads a dispatched delegation as one working child per goal', () => {
    const dispatched =
      '{"status": "dispatched", "mode": "background", "count": 1, "delegation_id": "deleg_ca00734f",' +
      ' "goals": ["Reply PONG"], "note": "Subagent is running in the background; its full result follows."}'
    expect(
      hermesToolSubagents(
        update({
          toolCallId: 'tc-2',
          status: 'completed',
          title: 'delegate_task: 1 tasks: Reply PONG',
          content: text('Delegating 1 tasks\n\n1. Reply PONG', dispatched)
        }),
        call('delegate_task: 1 tasks: Reply PONG')
      )
    ).toEqual([{ id: 'deleg_ca00734f', state: 'working', label: 'Reply PONG' }])
  })

  it('keeps a batch apart under the delegation id', () => {
    const dispatched = '{"status": "dispatched", "delegation_id": "deleg_1", "goals": ["First", "Second"]}'
    const children = hermesToolSubagents(
      update({
        toolCallId: 'tc-3',
        status: 'completed',
        title: 'delegate_task: 2 tasks: First / Second',
        content: text(dispatched)
      }),
      call('delegate_task: 2 tasks: First / Second')
    )
    expect(children.map((child) => child.id)).toEqual(['deleg_1:0', 'deleg_1:1'])
    expect(children.every((child) => child.state === 'working')).toBe(true)
  })

  it('ignores every other tool, and a call with no status', () => {
    expect(hermesToolSubagents(update({ toolCallId: 'tc', status: 'completed' }), call('terminal'))).toEqual([])
    expect(hermesToolSubagents(update({ toolCallId: 'tc', status: null }), call('delegate_task'))).toEqual([])
  })

  // Captured from Hermes: a backgrounded command answers with the process session id it runs under.
  it('reads a backgrounded command as a running task under its process id', () => {
    expect(
      hermesToolBackgroundTasks(
        update({
          toolCallId: 'tc-4',
          status: 'completed',
          title: 'terminal: sleep 300',
          content: text(
            '$ sleep 300',
            'terminal result\n- **output:** Background process started\n- **session_id:** proc_a31ce8cfab6b\n- **pid:** 288372'
          )
        }),
        call('terminal: sleep 300')
      )
    ).toEqual([
      {
        taskId: 'proc_a31ce8cfab6b',
        kind: 'command',
        label: 'sleep 300',
        state: 'working',
        parentToolUseId: 'tc-4'
      }
    ])
  })

  it('leaves a foreground command alone', () => {
    expect(
      hermesToolBackgroundTasks(
        update({
          toolCallId: 'tc-5',
          status: 'completed',
          title: 'terminal: ls',
          content: text('terminal result\n- **output:** a.txt\n- **exit_code:** 0')
        }),
        call('terminal: ls')
      )
    ).toEqual([])
  })
})
