import { describe, expect, it } from 'vitest'
import { claudeAccountIdFromTranscriptPath } from './claude-transcript-account'

describe('claudeAccountIdFromTranscriptPath', () => {
  it('reads the managed account whose folder holds the transcript', () => {
    expect(
      claudeAccountIdFromTranscriptPath(
        '/Users/me/Library/Application Support/orca/claude-profiles/acct-1/home/projects/-repo/s.jsonl'
      )
    ).toBe('acct-1')
  })

  it('reads a Windows transcript path', () => {
    expect(
      claudeAccountIdFromTranscriptPath(
        'C:\\Users\\me\\AppData\\Roaming\\orca\\claude-profiles\\acct-2\\home\\projects\\-repo\\s.jsonl'
      )
    ).toBe('acct-2')
  })

  it("reads the user's own folder as System default", () => {
    expect(claudeAccountIdFromTranscriptPath('/Users/me/.claude/projects/-repo/s.jsonl')).toBeNull()
  })

  it('does not take a project that merely mentions claude-profiles for an account', () => {
    expect(
      claudeAccountIdFromTranscriptPath(
        '/Users/me/.claude/projects/-Users-me-claude-profiles-acct-3-home/s.jsonl'
      )
    ).toBeNull()
  })
})
