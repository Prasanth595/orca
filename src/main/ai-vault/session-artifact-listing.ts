import type { Dirent } from 'node:fs'
import { readdir, lstat, realpath } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type {
  AiVaultSessionArtifact,
  AiVaultSessionArtifactListArgs,
  AiVaultSessionArtifactListResult
} from '../../shared/ai-vault-types'
import { isAntigravityTranscriptPath } from './session-scanner-antigravity-paths'
import { antigravitySessionOrigin } from '../../shared/antigravity-session-origin'
import { LOCAL_EXECUTION_HOST_ID } from '../../shared/execution-host'

const EXCLUDED_EXTENSIONS = new Set(['.metadata.json'])

/** Returns true if the filename matches a metadata extension that should be excluded. */
function isExcludedByExtension(name: string): boolean {
  return EXCLUDED_EXTENSIONS.has(name.endsWith('.metadata.json') ? '.metadata.json' : '')
}

/** Derives the conversation directory from a transcript path. */
export function conversationDirFromTranscriptPath(transcriptPath: string): string | null {
  if (!isAntigravityTranscriptPath(transcriptPath)) {
    return null
  }
  // transcript lives at brain/<id>/.system_generated/logs/transcript.jsonl
  return dirname(dirname(dirname(transcriptPath)))
}

/**
 * Validates that a conversation directory is a real Antigravity brain entry
 * by rejecting symlinks, resolving its canonical path, confirming it belongs
 * to a known `.gemini/<origin>/brain` root, and verifying the `.system_generated` marker.
 */
async function validateConversationDir(conversationDir: string): Promise<string | null> {
  try {
    // Reject a symlinked conversation directory before canonicalization.
    const dirStat = await lstat(conversationDir)
    if (!dirStat.isDirectory()) {
      return null
    }
    const resolved = await realpath(conversationDir)
    if (!antigravitySessionOrigin(resolved)) {
      return null
    }
    const marker = join(resolved, '.system_generated')
    const markerStat = await lstat(marker)
    if (!markerStat.isDirectory()) {
      return null
    }
    return resolved
  } catch {
    return null
  }
}

/** Lists artifact files in the conversation directory of an Antigravity session. */
export async function listSessionArtifacts(
  args?: AiVaultSessionArtifactListArgs
): Promise<AiVaultSessionArtifactListResult> {
  const empty: AiVaultSessionArtifactListResult = { artifacts: [] }
  if (!args || typeof args !== 'object') {
    return empty
  }
  if (typeof args.filePath !== 'string' || !args.filePath) {
    return empty
  }
  if (args.agent !== 'antigravity') {
    return empty
  }
  if (args.executionHostId !== undefined && typeof args.executionHostId !== 'string') {
    return empty
  }
  if (args.executionHostId && args.executionHostId !== LOCAL_EXECUTION_HOST_ID) {
    return empty
  }
  const conversationDir = conversationDirFromTranscriptPath(args.filePath)
  if (!conversationDir) {
    return empty
  }
  // Resolve symlinks and verify the directory is a real brain entry.
  const resolvedDir = await validateConversationDir(conversationDir)
  if (!resolvedDir) {
    return empty
  }
  let entries: Dirent[]
  try {
    entries = await readdir(resolvedDir, { withFileTypes: true })
  } catch {
    return empty
  }
  const artifacts: AiVaultSessionArtifact[] = []
  for (const entry of entries) {
    // Only list regular files; skip directories, symlinks, and other special entries.
    if (!entry.isFile()) {
      continue
    }
    if (isExcludedByExtension(entry.name)) {
      continue
    }
    const filePath = join(resolvedDir, entry.name)
    try {
      const stats = await lstat(filePath)
      if (!stats.isFile()) {
        continue
      }
      artifacts.push({ name: entry.name, filePath, sizeBytes: stats.size })
    } catch {
      // File may have been removed between readdir and stat.
    }
  }
  artifacts.sort((a, b) => a.name.localeCompare(b.name))
  return { artifacts }
}
