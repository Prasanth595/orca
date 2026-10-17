import { describe, expect, it } from 'vitest'
import {
  applySlashSuggestion,
  filterSlashCommands,
  getAgentSlashCommands,
  isSlashCommandDraft,
  nativeChatWorkflowRoute,
  sessionReportedSkillNames,
  sessionSlashCommandSuggestions,
  slashCommandDispatchText
} from './native-chat-slash-commands'

describe('getAgentSlashCommands', () => {
  it('returns Codex-specific commands (e.g. /model, /resume) for codex', () => {
    const names = getAgentSlashCommands('codex').map((c) => c.name)
    expect(names).toContain('model')
    expect(names).toContain('resume')
    expect(names).toContain('diff')
  })

  it('returns Claude commands for claude (no Codex-only /model)', () => {
    const names = getAgentSlashCommands('claude').map((c) => c.name)
    expect(names).toContain('clear')
    expect(names).toContain('compact')
    expect(names).not.toContain('model')
    // Claude's terminal writes no /context reply the chat could show.
    expect(names).not.toContain('context')
  })

  it('offers OpenClaude /context, whose report lands in its transcript', () => {
    const names = getAgentSlashCommands('openclaude').map((c) => c.name)
    expect(names).toEqual([...getAgentSlashCommands('claude').map((c) => c.name), 'context'])
  })

  it('falls back to a small common set for an unknown agent (never empty)', () => {
    const names = getAgentSlashCommands('some-other-agent').map((c) => c.name)
    expect(names).toEqual(['clear', 'help', 'workflow'])
  })
})

describe('isSlashCommandDraft', () => {
  it('is true for a leading slash, even with leading whitespace', () => {
    expect(isSlashCommandDraft('/clear')).toBe(true)
    expect(isSlashCommandDraft('  /model')).toBe(true)
  })

  it('is false for ordinary prose or a mid-line slash', () => {
    expect(isSlashCommandDraft('fix the bug')).toBe(false)
    expect(isSlashCommandDraft('run a/b test')).toBe(false)
    expect(isSlashCommandDraft('')).toBe(false)
  })
})

describe('filterSlashCommands', () => {
  const codex = getAgentSlashCommands('codex')

  it('returns all commands for an empty query (bare /)', () => {
    expect(filterSlashCommands(codex, '')).toHaveLength(codex.length)
  })

  it('prefix-matches case-insensitively', () => {
    const names = filterSlashCommands(codex, 'mod').map((c) => c.name)
    expect(names).toEqual(['model'])
    expect(filterSlashCommands(codex, 'MOD').map((c) => c.name)).toEqual(['model'])
  })
})

describe('dispatch vs completion text', () => {
  it('dispatch text has no trailing space (Enter dispatches the command)', () => {
    expect(slashCommandDispatchText({ name: 'clear' })).toBe('/clear')
  })

  it('completion text has a trailing space (Tab completes for arguments)', () => {
    expect(applySlashSuggestion({ name: 'model' })).toBe('/model ')
  })
})

describe('a session that reports its own command surface', () => {
  const reported = [
    { name: 'clear', kind: 'command' as const },
    { name: 'opsx:apply', kind: 'command' as const },
    { name: 'ref-oss', kind: 'skill' as const }
  ]

  it('offers exactly the reported commands, described from the curated catalog', () => {
    expect(sessionSlashCommandSuggestions('claude', reported)).toEqual([
      { name: 'clear', description: 'Clear conversation history' },
      { name: 'opsx:apply' }
    ])
  })

  it('does not resurrect a curated command the session never reported', () => {
    const names = sessionSlashCommandSuggestions('claude', reported).map((c) => c.name)
    expect(names).not.toContain('compact')
  })

  it('splits skills out for the picker to group on its own', () => {
    expect(sessionReportedSkillNames(reported)).toEqual(['ref-oss'])
  })

  it('prefers the description the session reported over the curated one', () => {
    expect(
      sessionSlashCommandSuggestions('claude', [
        { name: 'clear', kind: 'command', description: 'Wipe the transcript' },
        { name: 'goal', kind: 'command', description: 'Set or view the goal' },
        { name: 'compact', kind: 'command' }
      ])
    ).toEqual([
      { name: 'clear', description: 'Wipe the transcript' },
      { name: 'goal', description: 'Set or view the goal' },
      { name: 'compact', description: 'Summarize and compact the conversation' }
    ])
  })

  it('keeps a reported description and argument hint the curated catalog never claims', () => {
    expect(
      sessionSlashCommandSuggestions('codex', [
        {
          name: 'opsx:apply',
          kind: 'command',
          description: 'Apply the plan',
          argumentHint: '<plan-id>',
          kindUnspecified: true
        }
      ])
    ).toEqual([
      {
        name: 'opsx:apply',
        description: 'Apply the plan',
        argumentHint: '<plan-id>',
        kindUnspecified: true
      }
    ])
  })
})

describe('nativeChatWorkflowRoute', () => {
  it('routes the free text as the description the agent authors from, never a name', () => {
    const route = nativeChatWorkflowRoute('/workflow check how much space my local disk has left')
    expect(route).not.toBeNull()
    expect(route?.description).toBe('check how much space my local disk has left')
    expect(route?.routedPrompt).toContain('check how much space my local disk has left')
    expect(route?.routedPrompt).not.toMatch(/\/workflow/)
    expect(route?.routedPrompt).toContain('ORCA workflows import - --json')
  })

  it('routes a bare /workflow to a clarifying turn instead of a named empty graph', () => {
    const route = nativeChatWorkflowRoute('/workflow')
    expect(route?.description).toBeNull()
    expect(route?.routedPrompt).toContain('ask for the steps')
  })

  it('leaves non-command and near-miss drafts untouched', () => {
    expect(nativeChatWorkflowRoute('please /workflow this')).toBeNull()
    expect(nativeChatWorkflowRoute('/workflowboard standup reminder')).toBeNull()
    expect(nativeChatWorkflowRoute('/projects what')).toBeNull()
  })
})
