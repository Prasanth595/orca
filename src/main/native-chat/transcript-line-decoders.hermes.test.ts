import { describe, expect, it } from 'vitest'
import { decodeHermesTranscriptLine, expandHermesTranscriptLine } from './transcript-line-decoders'

const line = (record: unknown): string => JSON.stringify(record)

describe('decodeHermesTranscriptLine', () => {
  it('skips malformed lines and the session header', () => {
    expect(decodeHermesTranscriptLine('not json', 'f')).toBeNull()
    expect(decodeHermesTranscriptLine(line({ type: 'session', sessionId: 's' }), 'f')).toBeNull()
    expect(decodeHermesTranscriptLine(line({ type: 'compaction', id: 'c' }), 'f')).toBeNull()
  })

  it('decodes a user turn and keeps its timestamp', () => {
    const timestamp = '2026-10-12T18:49:21.000+07:00'
    const decoded = decodeHermesTranscriptLine(
      line({ type: 'message', id: 'm1', role: 'user', text: 'hello', timestamp }),
      'fallback'
    )

    expect(decoded).toEqual({
      id: 'm1',
      role: 'user',
      blocks: [{ type: 'text', text: 'hello' }],
      timestamp: Date.parse(timestamp),
      source: 'transcript'
    })
  })

  it('accepts content in place of text', () => {
    const decoded = decodeHermesTranscriptLine(
      line({ type: 'message', role: 'assistant', content: 'hi there' }),
      'fallback'
    )

    expect(decoded?.role).toBe('assistant')
    expect(decoded?.blocks).toEqual([{ type: 'text', text: 'hi there' }])
  })

  it('decodes a tool row as a call plus its result', () => {
    const decoded = decodeHermesTranscriptLine(
      line({ type: 'tool', name: 'terminal', input: { command: 'ls' }, output: 'a\nb' }),
      'fallback'
    )

    expect(decoded?.role).toBe('tool')
    expect(decoded?.blocks).toEqual([
      { type: 'tool-call', name: 'terminal', input: { command: 'ls' } },
      { type: 'tool-result', output: 'a\nb' }
    ])
  })

  it('marks a failed tool result', () => {
    const decoded = decodeHermesTranscriptLine(
      line({ type: 'tool', name: 'terminal', output: 'boom', isError: true }),
      'fallback'
    )

    expect(decoded?.blocks).toEqual([
      { type: 'tool-call', name: 'terminal', input: null },
      { type: 'tool-result', output: 'boom', isError: true }
    ])
  })

  it('falls back to the caller id and drops a turn with no text', () => {
    const decoded = decodeHermesTranscriptLine(
      line({ type: 'message', role: 'assistant', text: 'kept' }),
      'fallback-id'
    )
    expect(decoded?.id).toBe('fallback-id')
    expect(decodeHermesTranscriptLine(line({ type: 'message', role: 'assistant' }), 'f')).toBeNull()
  })
})

describe('expandHermesTranscriptLine', () => {
  it('expands a session row into one row per turn, carrying the session id', () => {
    const nested = line({
      sessionId: '20261013_120000_abcd',
      messages: [
        { type: 'message', role: 'user', text: 'hello' },
        { type: 'message', role: 'assistant', text: 'hi' }
      ]
    })
    const rows = expandHermesTranscriptLine(nested)
    expect(rows).toHaveLength(2)
    const decoded = rows.map((row) => decodeHermesTranscriptLine(row, 'fallback'))
    expect(decoded.map((message) => message?.blocks)).toEqual([
      [{ type: 'text', text: 'hello' }],
      [{ type: 'text', text: 'hi' }]
    ])
    expect(decoded[0]?.id).toContain('20261013_120000_abcd')
  })

  it('passes a row-per-turn line through untouched', () => {
    const row = line({ type: 'message', role: 'user', text: 'kept' })
    expect(expandHermesTranscriptLine(row)).toEqual([row])
    expect(expandHermesTranscriptLine('not json')).toEqual(['not json'])
  })
})
