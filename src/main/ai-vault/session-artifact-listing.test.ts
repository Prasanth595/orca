import { describe, expect, it } from 'vitest'
import { conversationDirFromTranscriptPath } from './session-artifact-listing'

describe('conversationDirFromTranscriptPath', () => {
  it('derives the conversation directory for a valid antigravity transcript path', () => {
    const transcriptPath =
      '/home/user/.gemini/antigravity-ide/brain/abc-123/.system_generated/logs/transcript.jsonl'
    expect(conversationDirFromTranscriptPath(transcriptPath)).toBe(
      '/home/user/.gemini/antigravity-ide/brain/abc-123'
    )
  })

  it('derives the conversation directory for transcript_full.jsonl', () => {
    const transcriptPath =
      '/home/user/.gemini/antigravity-ide/brain/abc-123/.system_generated/logs/transcript_full.jsonl'
    expect(conversationDirFromTranscriptPath(transcriptPath)).toBe(
      '/home/user/.gemini/antigravity-ide/brain/abc-123'
    )
  })

  it('returns null for a non-antigravity path', () => {
    expect(conversationDirFromTranscriptPath('/home/user/.claude/projects/foo/session.jsonl')).toBe(
      null
    )
  })

  it('returns null for an empty path', () => {
    expect(conversationDirFromTranscriptPath('')).toBe(null)
  })
})
