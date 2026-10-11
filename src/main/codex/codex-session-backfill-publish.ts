import { link, lstat, mkdir } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { parseCodexRolloutThreadId } from './codex-rollout-identity'
import {
  isCodexRolloutDeletionRecorded,
  withCodexSessionHistoryMutation
} from './codex-session-deletion-record'
import {
  readCodexSessionTargetStat,
  type CodexSessionBackfillAuditPass
} from './codex-session-backfill-audit-pass'
import { describeCodexSessionBackfillErrorCode } from './codex-session-backfill-audit'
import type {
  CodexSessionBackfillPaths,
  CodexSessionBackfillSummary
} from './codex-session-backfill-types'

export async function backfillOneManagedSessionFile(
  paths: CodexSessionBackfillPaths,
  managedSessionFilePath: string,
  summary: CodexSessionBackfillSummary,
  ensuredTargetDirectories: Set<string>,
  auditPass: CodexSessionBackfillAuditPass
): Promise<void> {
  const rollout = parseCodexRolloutThreadId(managedSessionFilePath)
  const publish = async (): Promise<void> => {
    if (isCodexRolloutDeletionRecorded(managedSessionFilePath)) {
      return
    }
    await publishManagedSessionFile(
      paths,
      managedSessionFilePath,
      summary,
      ensuredTargetDirectories,
      auditPass
    )
  }
  await (rollout
    ? withCodexSessionHistoryMutation(rollout.threadId, publish, {
        onBusy: () => {
          summary.deferredFiles = (summary.deferredFiles ?? 0) + 1
        }
      })
    : publish())
}

async function publishManagedSessionFile(
  paths: CodexSessionBackfillPaths,
  managedSessionFilePath: string,
  summary: CodexSessionBackfillSummary,
  ensuredTargetDirectories: Set<string>,
  auditPass: CodexSessionBackfillAuditPass
): Promise<void> {
  if (await isSymbolicLink(managedSessionFilePath)) {
    // Why: bridge-created symlinks already point at a file in the user's own
    // home; materializing them here could duplicate a foreign tree.
    summary.skippedSymlinkFiles += 1
    return
  }
  const relativePath = relative(paths.managedSessionsRoot, managedSessionFilePath)
  const systemSessionFilePath = join(paths.systemSessionsRoot, relativePath)
  const existingTargetStat = await readCodexSessionTargetStat(systemSessionFilePath)
  if (existingTargetStat) {
    await auditPass.recordExisting(
      summary,
      managedSessionFilePath,
      systemSessionFilePath,
      existingTargetStat
    )
    return
  }

  let linkAttempted = false
  try {
    const targetDirectory = dirname(systemSessionFilePath)
    if (!ensuredTargetDirectories.has(targetDirectory)) {
      // Why: one date directory can contain thousands of rollouts; avoid a
      // redundant filesystem round trip before every hardlink.
      await mkdir(targetDirectory, { recursive: true })
      ensuredTargetDirectories.add(targetDirectory)
    }
    linkAttempted = true
    await link(managedSessionFilePath, systemSessionFilePath)
    summary.linkedFiles += 1
    await auditPass.recordPublished(
      summary,
      'hardlink',
      managedSessionFilePath,
      systemSessionFilePath
    )
  } catch (linkError) {
    if (linkAttempted && isExistsError(linkError)) {
      // Why: another window can publish the target after our existence probe;
      // enqueue it here too in case that writer died before its audit append.
      await auditPass.recordExisting(
        summary,
        managedSessionFilePath,
        systemSessionFilePath,
        await readCodexSessionTargetStat(systemSessionFilePath)
      )
      return
    }
    if (isNotFoundError(linkError)) {
      ensuredTargetDirectories.delete(dirname(systemSessionFilePath))
    }
    const sourceStat = await readCodexSessionTargetStat(managedSessionFilePath)
    if (linkAttempted && isUnsupportedHardlinkError(linkError)) {
      // Why: a mutable rollout cannot be kept coherent by a cross-volume snapshot.
      summary.skippedUnsupportedFilesystemFiles += 1
      await auditPass.recordDiagnostic(
        {
          action: 'copy-unsupported',
          source: managedSessionFilePath,
          target: systemSessionFilePath,
          linkErrorCode: describeCodexSessionBackfillErrorCode(linkError)
        },
        sourceStat
      )
      return
    }
    summary.failedFiles += 1
    await auditPass.recordDiagnostic(
      {
        action: 'failed',
        source: managedSessionFilePath,
        target: systemSessionFilePath,
        linkError: describeError(linkError),
        linkErrorCode: describeCodexSessionBackfillErrorCode(linkError)
      },
      sourceStat
    )
  }
}

async function isSymbolicLink(filePath: string): Promise<boolean> {
  try {
    return (await lstat(filePath)).isSymbolicLink()
  } catch {
    return false
  }
}

function isExistsError(error: unknown): boolean {
  return describeCodexSessionBackfillErrorCode(error) === 'EEXIST'
}

function isNotFoundError(error: unknown): boolean {
  return describeCodexSessionBackfillErrorCode(error) === 'ENOENT'
}

function isUnsupportedHardlinkError(error: unknown): boolean {
  const code = describeCodexSessionBackfillErrorCode(error)
  return code === 'EXDEV' || code === 'ENOTSUP' || code === 'EOPNOTSUPP' || code === 'ENOSYS'
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
