import { scanFileRegionsBackward } from './reverse-file-region-scan'
import { TRANSCRIPT_CHUNK_BYTES, TRANSCRIPT_MAX_SCAN_BYTES } from './transcript-reader'
import { isRecord } from '../agent-status-child-work-value-guards'
import { deriveToolInputPreview } from './tool-input-preview'

export type ClaudePermissionIdentity = {
  sessionId: string
  toolUseId: string
  agentId?: string
  inferredTool?: { name: string; input?: string }
}

function ownsRow(row: Record<string, unknown>, identity: ClaudePermissionIdentity): boolean {
  return (
    row.sessionId === identity.sessionId &&
    row.agentId === identity.agentId &&
    (identity.agentId !== undefined || (row.isSidechain !== true && row.parent_tool_use_id == null))
  )
}

/** A terminal result settles a request, not the turn or its approval decision. */
export function readClaudePermissionResult(
  transcriptPath: string,
  identity: ClaudePermissionIdentity
): boolean {
  if (!identity.sessionId || !identity.toolUseId) {
    return false
  }
  let firstRegion = true
  let cursor: string | undefined
  let resultSeen = false
  let callSeen = false
  const settledTools = new Set<string>()
  const visited = new Set<string>()
  return (
    scanFileRegionsBackward(
      transcriptPath,
      { chunkBytes: TRANSCRIPT_CHUNK_BYTES, maxScanBytes: TRANSCRIPT_MAX_SCAN_BYTES },
      (region) => {
        const lines = region.toString('utf8').split('\n')
        // A trailing write has no committed JSONL boundary yet.
        if (firstRegion && lines.at(-1) !== '') {
          return false
        }
        firstRegion = false
        for (let index = lines.length - 1; index >= 0; index -= 1) {
          const line = lines[index].trim()
          if (!line) {
            continue
          }
          let row: unknown
          try {
            row = JSON.parse(line)
          } catch {
            return false
          }
          if (!isRecord(row) || !ownsRow(row, identity)) {
            continue
          }
          if (
            typeof row.uuid !== 'string' ||
            !row.uuid ||
            !['user', 'assistant', 'system', 'attachment'].includes(String(row.type))
          ) {
            continue
          }
          // Follow the current branch, never a result on an abandoned sibling branch.
          if (cursor !== undefined && row.uuid !== cursor) {
            continue
          }
          if (visited.has(row.uuid)) {
            return false
          }
          visited.add(row.uuid)
          let hasToolResult = false
          if (isRecord(row.message) && Array.isArray(row.message.content)) {
            for (const block of row.message.content) {
              if (!isRecord(block)) {
                continue
              }
              if (
                row.type === 'user' &&
                row.message.role === 'user' &&
                block.type === 'tool_result' &&
                typeof block.tool_use_id === 'string'
              ) {
                hasToolResult = true
                settledTools.add(block.tool_use_id)
                if (block.tool_use_id === identity.toolUseId) {
                  resultSeen = true
                }
              }
              if (
                row.type === 'assistant' &&
                row.message.role === 'assistant' &&
                block.type === 'tool_use'
              ) {
                const inferred = identity.inferredTool
                const matchesInferred =
                  inferred &&
                  block.name === inferred.name &&
                  (inferred.input === undefined ||
                    deriveToolInputPreview(inferred.name, block.input) === inferred.input)
                // Missing ids cannot distinguish identical parallel requests: each candidate must end.
                if (
                  matchesInferred &&
                  (typeof block.id !== 'string' || !settledTools.has(block.id))
                ) {
                  return false
                }
                if (block.id === identity.toolUseId) {
                  if (!resultSeen || (inferred && !matchesInferred)) {
                    return false
                  }
                  if (!inferred) {
                    return true
                  }
                  callSeen = true
                }
              }
            }
          }
          if (identity.inferredTool && row.type === 'user' && !hasToolResult) {
            return callSeen
          }
          if (typeof row.parentUuid !== 'string' || !row.parentUuid) {
            return row.parentUuid === null && identity.inferredTool !== undefined && callSeen
          }
          cursor = row.parentUuid
        }
        return undefined
      }
    ) === true
  )
}
