import { describe, expect, it, vi } from 'vitest'

import { formatCliError, reportCliError } from './format'
import { RuntimeClientError, RuntimeRpcFailureError } from './runtime-client'

function selectorNotFound(): RuntimeRpcFailureError {
  return new RuntimeRpcFailureError({
    id: 'req_selector',
    ok: false,
    error: { code: 'selector_not_found', message: 'selector_not_found' },
    _meta: { runtimeId: 'runtime_local' }
  })
}

describe('worktree selector recovery', () => {
  it('names the offending value and the valid forms on a bare repo id', () => {
    const output = formatCliError(selectorNotFound(), {
      commandPath: ['orchestration', 'worker-start'],
      worktreeSelector: 'id:github:stablyai/orca'
    })

    expect(output).toContain('No Orca workspace matched the worktree selector')
    expect(output).toContain('id:github:stablyai/orca')
    expect(output).toContain('Did you mean: id:github:stablyai/orca::<absolute-path>')
    expect(output).toContain('Valid selector forms:')
    expect(output).toContain('a bare repository id is not a worktree id')
  })

  it('carries the same recovery into the --json failure envelope', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    reportCliError(selectorNotFound(), true, {
      commandPath: ['terminal', 'create'],
      worktreeSelector: 'path:/nope'
    })

    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      error: {
        code: 'selector_not_found',
        data: { selector: 'path:/nope', validSelectorForms: expect.arrayContaining(['current']) }
      }
    })
    log.mockRestore()
  })

  it('keeps the selector grammar when the error already carries mutation recovery data', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    reportCliError(
      new RuntimeRpcFailureError({
        id: 'req_selector',
        ok: false,
        error: {
          code: 'selector_not_found',
          message: 'selector_not_found',
          // The mutation-recovery layer already attached its request id.
          data: { orchestrationRequestId: 'req_abc', nextSteps: ['Run request-show first.'] }
        },
        _meta: { runtimeId: 'runtime_local' }
      }),
      true,
      { commandPath: ['orchestration', 'worker-start'], worktreeSelector: 'bare-repo-id' }
    )

    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      error: {
        data: {
          orchestrationRequestId: 'req_abc',
          selector: 'bare-repo-id',
          validSelectorForms: expect.arrayContaining(['current']),
          nextSteps: expect.arrayContaining(['Run request-show first.'])
        }
      }
    })
    log.mockRestore()
  })

  it('keeps both recoveries in the text message for a local selector error', () => {
    const output = formatCliError(
      new RuntimeClientError('selector_not_found', 'selector_not_found', {
        orchestrationRequestId: 'req_abc',
        nextSteps: ['Run request-show first.']
      }),
      { worktreeSelector: 'bare-repo-id' }
    )

    expect(output).toContain('Valid selector forms:')
    expect(output).toContain('Run request-show first.')
  })

  it('stays silent when no worktree selector was passed', () => {
    expect(formatCliError(selectorNotFound(), { commandPath: ['worktree', 'show'] })).toBe(
      'selector_not_found'
    )
  })
})

describe('terminal handle recovery', () => {
  // The runtime flattens a split whose source pane is gone to a bare runtime_error.
  const splitSourceNotFound = () =>
    new RuntimeRpcFailureError({
      id: 'req_split',
      ok: false,
      error: {
        code: 'runtime_error',
        message: 'terminal_split_source_not_found'
      },
      _meta: { runtimeId: 'runtime_local' }
    })
  const handleStale = () =>
    new RuntimeRpcFailureError({
      id: 'req_send',
      ok: false,
      error: { code: 'terminal_handle_stale', message: 'terminal_handle_stale' },
      _meta: { runtimeId: 'runtime_local' }
    })

  it('names the handle and the next step when a split source pane is gone', () => {
    const output = formatCliError(splitSourceNotFound(), {
      commandPath: ['terminal', 'split'],
      terminalHandle: 'term_closed1'
    })

    expect(output).toContain('terminal_split_source_not_found')
    expect(output).toContain('"term_closed1" no longer exists')
    expect(output).toContain('orca terminal list')
  })

  it('names the handle and the next step when a send targets a stale handle', () => {
    const output = formatCliError(handleStale(), {
      commandPath: ['terminal', 'send'],
      terminalHandle: 'term_old_leader'
    })

    expect(output).toContain('terminal_handle_stale')
    expect(output).toContain('"term_old_leader" no longer exists')
    expect(output).toContain('orca terminal list')
  })

  it('keeps the error code and adds the handle to the --json failure envelope', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})

    reportCliError(handleStale(), true, {
      commandPath: ['terminal', 'send'],
      terminalHandle: 'term_old_leader'
    })

    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      error: {
        code: 'terminal_handle_stale',
        data: {
          terminalHandle: 'term_old_leader',
          nextSteps: [expect.stringContaining('term_old_leader')]
        }
      }
    })
    log.mockRestore()
  })

  it('stays silent when no handle was passed or the error is unrelated', () => {
    expect(formatCliError(handleStale(), { commandPath: ['terminal', 'send'] })).toBe(
      'terminal_handle_stale'
    )
    expect(formatCliError(selectorNotFound(), { terminalHandle: 'term_x' })).toBe(
      'selector_not_found'
    )
  })
})

describe('CLI error recovery', () => {
  it('prints did-you-mean next steps for an unknown-command error carrying data', () => {
    const error = new RuntimeClientError('invalid_argument', 'Unknown command: worktree remov', {
      suggestions: ['worktree rm'],
      nextSteps: ['Did you mean: orca worktree rm']
    })

    const output = formatCliError(error)

    expect(output).toContain('Unknown command: worktree remov')
    expect(output).toContain('Next step: Did you mean: orca worktree rm')
  })

  it('prefers structured recovery over generic computer hints in text output', () => {
    const error = new RuntimeClientError('invalid_argument', 'Unknown flag --forcce', {
      nextSteps: ['Did you mean: --force']
    })

    const output = formatCliError(error, { commandPath: ['computer', 'click'] })

    expect(output).toContain('Next step: Did you mean: --force')
    expect(output).not.toContain('Fix the command flags or RPC params')
  })

  it('prefers RPC recovery over generic computer hints in text output', () => {
    const error = new RuntimeRpcFailureError({
      id: 'req_rpc_recovery',
      ok: false,
      error: {
        code: 'invalid_argument',
        message: 'Unknown runtime argument',
        data: { nextSteps: ['Use the runtime-specific option'] }
      },
      _meta: { runtimeId: 'runtime_local' }
    })

    const output = formatCliError(error, { commandPath: ['computer', 'click'] })

    expect(output).toContain('Next step: Use the runtime-specific option')
    expect(output).not.toContain('Fix the command flags or RPC params')
  })

  it('keeps generic computer hints when an RPC error has no recovery data', () => {
    const error = new RuntimeRpcFailureError({
      id: 'req_rpc_fallback',
      ok: false,
      error: { code: 'invalid_argument', message: 'Invalid computer argument' },
      _meta: { runtimeId: 'runtime_local' }
    })

    const output = formatCliError(error, { commandPath: ['computer', 'click'] })

    expect(output).toContain('Fix the command flags or RPC params')
  })

  it('does not replace mutation recovery with generic runtime startup advice', () => {
    const error = new RuntimeClientError(
      'runtime_unavailable',
      'Re-issue the same command with --retry-request mutation_1.',
      { orchestrationRequestId: 'mutation_1' }
    )

    const output = formatCliError(error)

    expect(output).toContain('--retry-request mutation_1')
    expect(output).not.toContain('orca open')
  })
})
