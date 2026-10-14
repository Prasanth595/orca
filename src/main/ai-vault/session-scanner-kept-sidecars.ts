import type { AiVaultAgent, AiVaultScanIssue } from '../../shared/ai-vault-types'
import { WslTranscriptFsError } from '../native-chat/wsl-transcript-fs-gate'
import { wslGatedStat } from '../native-chat/wsl-transcript-fs-access'
import { throwIfAiVaultScanCancelled } from './ai-vault-scan-cancellation'
import { noteAiVaultScanProgress } from './ai-vault-scan-progress'
import { recordSessionScanIssue } from './session-scan-issues'
import type { FileWithMtime } from './session-scanner-types'
import { errorMessage } from './session-scanner-values'
import type { SessionSidecarObservation } from './session-sidecar-stat'

type KeptSidecar = { file: FileWithMtime; sidecarPath?: string } | { error: unknown }

// Why: resolving every sidecar before the recency cap walks chats the scan never returns.
export async function attachKeptSidecars(
  kept: FileWithMtime[],
  args: {
    rootDir: string
    agent: AiVaultAgent
    issues: AiVaultScanIssue[]
    contentDependencyPath?: (path: string) => string | undefined | Promise<string | undefined>
    signal?: AbortSignal
  },
  traversal: ReadonlyMap<string, number>,
  inSlot: <T>(read: () => Promise<T>) => Promise<T>
): Promise<FileWithMtime[]> {
  const resolve = args.contentDependencyPath
  if (!resolve) {
    return kept
  }
  const read = async (file: FileWithMtime): Promise<KeptSidecar> => {
    try {
      const sidecarPath = await resolve(file.path)
      const sidecar = await observeSessionSidecar(sidecarPath, args.signal)
      return { file: { ...file, sidecar }, sidecarPath }
    } catch (error) {
      return { error }
    }
  }
  const observed: { path: string; order: number; entry: KeptSidecar }[] = []
  for (const file of kept) {
    throwIfAiVaultScanCancelled(args.signal)
    const entry = await inSlot(() => read(file))
    noteAiVaultScanProgress(args.signal)
    observed.push({ path: file.path, order: traversal.get(file.path) ?? 0, entry })
  }
  // A read the cancel cut short is not an unreadable sidecar; never record it.
  throwIfAiVaultScanCancelled(args.signal)
  // Issues in traversal order, as a scan that read every sidecar would report them.
  let refusedSidecar = false
  for (const { path, entry } of [...observed].sort((a, b) => a.order - b.order)) {
    if ('error' in entry) {
      recordSessionScanIssue(args.issues, {
        agent: args.agent,
        path,
        message: errorMessage(entry.error)
      })
    } else if (entry.file.sidecar === 'unknown' && !refusedSidecar) {
      // One issue per root: a refused sibling is a property of the tree,
      // not of each transcript that happens to point at it.
      refusedSidecar = true
      recordSessionScanIssue(args.issues, {
        agent: args.agent,
        path: entry.sidecarPath ?? args.rootDir,
        message: 'Session metadata could not be read this scan.'
      })
    }
  }
  return observed.flatMap(({ entry }) => ('file' in entry ? [entry.file] : []))
}

/**
 * A sibling that cannot be statted is not "no sibling": it must not take the
 * transcript down with it, and it must not read as absent either, or the parse
 * cache would treat a session enriched from a file nobody can see as current
 * forever. Only a genuinely missing path is `'none'`; every other failure —
 * a stalled WSL distro, EACCES, EIO — is `'unknown'`.
 */
async function observeSessionSidecar(
  filePath: string | undefined,
  signal?: AbortSignal
): Promise<SessionSidecarObservation> {
  if (!filePath) {
    return 'none'
  }
  try {
    const fileStat = await wslGatedStat(filePath, 'scan', signal)
    return { path: filePath, mtimeMs: fileStat.mtimeMs, sizeBytes: fileStat.size }
  } catch (error) {
    return isMissingSidecarError(error) ? 'none' : 'unknown'
  }
}

function isMissingSidecarError(error: unknown): boolean {
  if (error instanceof WslTranscriptFsError) {
    return false
  }
  const code =
    error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
      ? error.code
      : null
  return code === 'ENOENT' || code === 'ENOTDIR'
}
