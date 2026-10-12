import { createHash } from 'node:crypto'
import { addPreviewContent, timestampIso, updateTimeline } from './session-scanner-accumulator'
import {
  boundedText,
  toolCallText,
  transcriptMessagesFromContent
} from './session-transcript-message-content'
import { asRecord, extractString, parseJsonObject } from './session-scanner-values'
import type { SessionAccumulator } from './session-scanner-types'

// Canonical v2 messages mirror context events; only tool events need the streaming fallback.
export function createKimiV2WireConsumer(accumulator: SessionAccumulator, preview = true) {
  const seen = new Set<string>()
  const first = (kind: string, id: unknown, text: string, time: unknown): boolean => {
    const hash = createHash('sha256').update(text).digest('hex')
    const key = `${kind}:${extractString(id) ?? timestampIso(time)}:${hash}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  }
  const tool = (kind: string, id: unknown, text: string | null, time: unknown): void => {
    if (!accumulator.messages.active || !text) {
      return
    }
    const bounded = boundedText(text)
    if (bounded && first(kind, id, bounded, time)) {
      accumulator.messages.push({ role: 'tool', text: bounded, timestamp: timestampIso(time) })
    }
  }
  const call = (value: unknown, time: unknown): void => {
    const record = asRecord(value)
    if (!record) {
      return
    }
    const raw = record.args ?? record.arguments
    const args = typeof raw === 'string' ? (parseJsonObject(raw) ?? raw) : raw
    tool('call', record.toolCallId ?? record.id, toolCallText(record.name, args), time)
  }
  return {
    consume(record: Record<string, unknown>): boolean {
      const time = record.time
      if (record.type === 'context.append_message') {
        return true
      }
      if (record.type === 'context.append_loop_event') {
        const event = asRecord(record.event)
        if (event?.type === 'tool.call' || event?.type === 'tool.result') {
          updateTimeline(accumulator, time)
        }
        if (event?.type === 'tool.call') {
          call(event, time)
        }
        if (event?.type === 'tool.result') {
          const output = asRecord(event.result)?.output
          for (const message of transcriptMessagesFromContent('tool', output, timestampIso(time))) {
            tool('result', event.toolCallId, message.text, time)
          }
        }
        return true
      }
      if (record.type !== 'agent.message.appended') {
        return false
      }
      const envelope = asRecord(record.message)
      const message = asRecord(envelope?.message)
      const meta = asRecord(envelope?.meta)
      if (!message) {
        return true
      }
      const timestamp = time ?? meta?.createdAt
      updateTimeline(accumulator, timestamp)
      if (message.role === 'tool') {
        for (const item of transcriptMessagesFromContent(
          'tool',
          message.content,
          timestampIso(timestamp)
        )) {
          tool('result', message.toolCallId, item.text, timestamp)
        }
        return true
      }
      if (message.role !== 'user' && message.role !== 'assistant') {
        return true
      }
      if (message.role === 'user' && asRecord(meta?.origin)?.kind === 'injection') {
        return true
      }
      const texts = transcriptMessagesFromContent(
        message.role,
        message.content,
        timestampIso(timestamp)
      )
      const identity = meta?.messageId ?? meta?.userMessageId
      if (!first(message.role, identity, texts.map((item) => item.text).join('\n'), timestamp)) {
        return true
      }
      if (preview) {
        updateTimeline(accumulator, timestamp)
        accumulator.messageCount++
        addPreviewContent(accumulator, message.role, message.content, timestamp)
      } else {
        for (const item of texts) {
          accumulator.messages.push(item)
        }
      }
      if (Array.isArray(message.toolCalls)) {
        for (const item of message.toolCalls) {
          call(item, timestamp)
        }
      }
      return true
    }
  }
}
