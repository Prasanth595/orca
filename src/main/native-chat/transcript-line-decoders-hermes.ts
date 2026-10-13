// hermes (Hermes Agent) JSONL line → NativeChatMessage decoder.
//
// Hermes keeps its own sessions in SQLite and exports the transcript Orca reads as
// JSONL: a `session` header row, then `message` rows (user/assistant) and `tool`
// rows. Only the shapes below are guaranteed, so an unknown or malformed line is
// skipped rather than thrown (schema drift).

import type { NativeChatBlock, NativeChatMessage } from '../../shared/native-chat-types'
import { extractString, parseJsonObject, timestampMs } from '../ai-vault/session-scanner-values'
import { toolResultOutput } from './transcript-record-blocks'

export function decodeHermesTranscriptLine(
  line: string,
  fallbackId: string
): NativeChatMessage | null {
  const record = parseJsonObject(line)
  if (!record) {
    return null
  }
  const type = extractString(record.type)
  // The header row carries identity (session id, cwd, model), not a turn.
  if (type === 'session') {
    return null
  }
  const role = extractString(record.role)
  const id = extractString(record.id) ?? fallbackId
  const timestamp = parseTimestamp(record.timestamp)

  if (type === 'tool' || role === 'tool') {
    const blocks: NativeChatBlock[] = []
    const name = extractString(record.name)
    if (name) {
      blocks.push({ type: 'tool-call', name, input: record.input ?? null })
    }
    blocks.push({
      type: 'tool-result',
      output: toolResultOutput(record.output ?? record.text ?? record.content),
      ...(record.isError === true ? { isError: true } : {})
    })
    return { id, role: 'tool', blocks, timestamp, source: 'transcript' }
  }

  if (type !== undefined && type !== 'message') {
    return null
  }
  if (role !== 'user' && role !== 'assistant' && role !== 'system') {
    return null
  }
  const text = extractString(record.text) ?? extractString(record.content)
  if (!text) {
    return null
  }
  return { id, role, blocks: [{ type: 'text', text }], timestamp, source: 'transcript' }
}

/** `timestampMs` yields NaN for an unparsable value; the chat model wants null. */
function parseTimestamp(value: unknown): number | null {
  const parsed = timestampMs(value)
  return Number.isFinite(parsed) ? parsed : null
}
