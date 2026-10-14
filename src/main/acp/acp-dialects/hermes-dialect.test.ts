import { describe, expect, it } from 'vitest'
import type { AgentJournalToolCallItem } from '../../../shared/agent-session-journal-types'
import type { ToolCallUpdate } from '../generated/acp-protocol.generated'
import {
  HERMES_ACP_DIALECT,
  hermesToolBackgroundTasks,
  hermesToolSubagents
} from './hermes-dialect'

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
    // No dispatch and no results: a control call (`stop`, `steer`, `list`) spawns nothing.
    expect(
      hermesToolSubagents(
        update({ toolCallId: 'tc-1', status: 'completed', title: 'delegate_task: 1 tasks: PONG' }),
        call('delegate_task: 1 tasks: Reply with PONG')
      )
    ).toEqual([])
  })

  it('makes no rows for a control call that names a subagent', () => {
    expect(
      hermesToolSubagents(
        update({
          toolCallId: 'tc-stop',
          status: 'completed',
          title: 'delegate_task: stop child-1',
          content: text('{"action": "stop", "subagent_id": "child-1"}', 'stopped child-1')
        }),
        call('delegate_task: stop child-1')
      )
    ).toEqual([])
  })

  it('keeps a dispatched child working when prose follows the answer', () => {
    const dispatched = '{"status": "dispatched", "delegation_id": "deleg_9", "goals": ["Reply PONG"]}'
    expect(
      hermesToolSubagents(
        update({
          toolCallId: 'tc-10',
          status: 'completed',
          title: 'delegate_task: 1 tasks: Reply PONG',
          content: text(dispatched, 'Follow the progress in the roster {see note}')
        }),
        call('delegate_task: 1 tasks: Reply PONG')
      )
    ).toEqual([{ id: 'deleg_9', state: 'working', label: 'Reply PONG' }])
  })

  it('reads a synchronous batch as one finished row per task', () => {
    const results =
      '{"total_duration_seconds": 4.2, "results": [' +
      '{"task_index": 0, "status": "completed", "summary": "First done"},' +
      '{"task_index": 1, "status": "failed", "error": "Second failed"}]}'
    const rows = hermesToolSubagents(
      update({
        toolCallId: 'tc-11',
        status: 'completed',
        title: 'delegate_task: 2 tasks: First / Second',
        content: text(results)
      }),
      call('delegate_task: 2 tasks: First / Second')
    )
    expect(rows.map((row) => [row.id, row.state, row.result])).toEqual([
      ['tc-11:0', 'completed', 'First done'],
      ['tc-11:1', 'failed', 'Second failed']
    ])
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

  // Captured from Hermes: the kill echoes the call's input and answers with the session it ended.
  it('settles the launched task when the process tool kills it', () => {
    expect(
      hermesToolBackgroundTasks(
        update({
          toolCallId: 'tc-6',
          status: 'completed',
          title: 'process_manage: kill proc_7a7f15c3446',
          content: text(
            '{"action": "kill", "session_id": "proc_7a7f15c3446b"}',
            'process_manage result\n- **status:** killed\n- **session_id:** proc_7a7f15c3446b'
          )
        }),
        call('process_manage: kill proc_7a7f15c3446')
      )
    ).toEqual([{ taskId: 'proc_7a7f15c3446b', kind: 'command', label: 'kill proc_7a7f15c3446', state: 'done' }])
  })

  it('ignores a process call that only polls', () => {
    expect(
      hermesToolBackgroundTasks(
        update({
          toolCallId: 'tc-7',
          status: 'completed',
          title: 'process_manage: poll',
          content: text('{"action": "poll", "session_id": "proc_7a7f15c3446b"}', 'still running')
        }),
        call('process_manage: poll')
      )
    ).toEqual([])
  })
})

describe('hermes delegation notices', () => {
  /** A finished batch, as the ACP adapter reports it after the children finished. */
  function notice(subagents: unknown, extra: Record<string, unknown> = {}) {
    return {
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: '2 of 2 subagents finished' },
        _meta: { hermes: { subagents } },
        ...extra
      }
    }
  }

  it('settles the rows the dispatch drew, keyed the way the dispatch keyed them', () => {
    const mapped = HERMES_ACP_DIALECT.notification?.(
      'session/update',
      notice([
        { id: 'deleg_abc:0', state: 'completed', summary: 'hi from one' },
        { id: 'deleg_abc:1', state: 'failed', summary: 'boom' }
      ]),
      1
    )

    expect(mapped).toEqual({
      disposition: 'map',
      subagents: [
        { id: 'deleg_abc:0', state: 'completed', result: 'hi from one' },
        { id: 'deleg_abc:1', state: 'failed', result: 'boom' }
      ]
    })
  })

  it('carries what each child is in while the batch runs', () => {
    const mapped = HERMES_ACP_DIALECT.notification?.(
      'session/update',
      {
        sessionId: 'session-1',
        update: {
          sessionUpdate: 'session_info_update',
          _meta: {
            hermes: {
              progress: true,
              subagents: [
                { id: 'deleg_abc:0', state: 'working', label: 'say one', activity: 'search_files' },
                { id: 'deleg_abc:1', state: 'working', label: 'say two', activity: 'read_file' }
              ]
            }
          }
        }
      },
      1
    )

    expect(mapped).toEqual({
      disposition: 'map',
      subagents: [
        { id: 'deleg_abc:0', state: 'working', label: 'say one', activity: 'search_files' },
        { id: 'deleg_abc:1', state: 'working', label: 'say two', activity: 'read_file' }
      ]
    })
  })

  it('drops a state the roster does not have, keeping the rows it does', () => {
    const mapped = HERMES_ACP_DIALECT.notification?.(
      'session/update',
      notice([{ id: 'deleg_abc:0', state: 'exploded' }, { id: 'deleg_abc:1', state: 'stopped' }]),
      1
    )

    expect(mapped).toEqual({
      disposition: 'map',
      subagents: [{ id: 'deleg_abc:1', state: 'stopped' }]
    })
  })

  it('leaves every other notification to the default path', () => {
    expect(
      HERMES_ACP_DIALECT.notification?.('session/update', notice([]), 1)
    ).toBeUndefined()
    expect(
      HERMES_ACP_DIALECT.notification?.('session/update', { sessionId: 's', update: {} }, 1)
    ).toBeUndefined()
    expect(HERMES_ACP_DIALECT.notification?.('_x/y', { anything: true }, 1)).toBeUndefined()
  })
})
