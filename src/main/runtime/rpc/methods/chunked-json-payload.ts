import {
  JIRA_PAYLOAD_CHUNK_CHARS,
  JIRA_PAYLOAD_MAX_CHARS
} from '../../../../shared/jira-payload-stream'

/**
 * Emits a JSON result as `{type:'chunk'}` frames then `{type:'end'}`, the shape clients
 * reassemble. Why: remote runtime WebSocket messages are capped at 1 MiB, so a large result
 * crosses SSH and paired runtimes in pieces instead of raising that safety cap.
 */
export function emitChunkedJsonPayload(
  value: unknown,
  emit: (result: unknown) => void,
  label: string
): void {
  const payload = JSON.stringify(value)
  if (payload.length > JIRA_PAYLOAD_MAX_CHARS) {
    throw new Error(`${label} payload exceeded the transfer limit.`)
  }
  for (let offset = 0; offset < payload.length; offset += JIRA_PAYLOAD_CHUNK_CHARS) {
    emit({ type: 'chunk', content: payload.slice(offset, offset + JIRA_PAYLOAD_CHUNK_CHARS) })
  }
  emit({ type: 'end' })
}
