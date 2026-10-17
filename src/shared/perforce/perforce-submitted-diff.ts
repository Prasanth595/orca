import type { GitDiffResult } from '../git-diff-compare-types'
import type { PerforceFileAction, PerforceSubmittedFile } from './perforce-types'
import { escapeP4FileArg, runP4, runP4OrThrow } from './p4-command'
import { parseTaggedOutput } from './p4-tagged-output'
import { parseSubmittedDiffPath } from './perforce-submitted-paths'

function looksBinary(content: string): boolean {
  return content.slice(0, 8000).includes('\0')
}

async function printDepotRevision(
  cwd: string,
  depotPath: string,
  revision: string
): Promise<string> {
  const result = await runP4(['print', '-q', `${escapeP4FileArg(depotPath)}${revision}`], { cwd })
  return result.code === 0 ? result.stdout : ''
}

function toAction(raw: string | undefined): PerforceFileAction {
  const KNOWN: readonly PerforceFileAction[] = [
    'add',
    'edit',
    'delete',
    'branch',
    'integrate',
    'move/add',
    'move/delete',
    'archive',
    'purge',
    'import'
  ]
  return KNOWN.find((a) => a === raw) ?? 'unknown'
}

/** Diff between the depot revision introduced by `changelist` and its immediate predecessor. */
async function getSubmittedFileDiff(
  cwd: string,
  changelist: number,
  depotPath: string,
  action: PerforceFileAction
): Promise<GitDiffResult> {
  const isAdd =
    action === 'add' || action === 'move/add' || action === 'branch' || action === 'import'
  const isDelete =
    action === 'delete' || action === 'move/delete' || action === 'purge' || action === 'archive'
  const [original, modified] = await Promise.all([
    isAdd ? Promise.resolve('') : printDepotRevision(cwd, depotPath, `@${changelist - 1}`),
    isDelete ? Promise.resolve('') : printDepotRevision(cwd, depotPath, `@${changelist}`)
  ])
  if (looksBinary(original) || looksBinary(modified)) {
    return {
      kind: 'binary',
      originalContent: '',
      modifiedContent: '',
      originalIsBinary: true,
      modifiedIsBinary: true,
      ...(isDelete ? { modifiedDeleted: true } : {})
    }
  }
  return {
    kind: 'text',
    originalContent: original,
    modifiedContent: modified,
    originalIsBinary: false,
    modifiedIsBinary: false,
    ...(isDelete ? { modifiedDeleted: true } : {})
  }
}

/**
 * Handles `rawFilePath` encoded by `toSubmittedDiffPath`. Returns null when the path is not a
 * submitted diff target so callers can fall through to workspace-based diffing.
 */
export async function tryGetPerforceSubmittedDiff(
  cwd: string,
  rawFilePath: string
): Promise<GitDiffResult | null> {
  const target = parseSubmittedDiffPath(rawFilePath)
  if (!target) {
    return null
  }
  return getSubmittedFileDiff(cwd, target.changelist, target.depotPath, target.action)
}

export async function getPerforceSubmittedFiles(
  cwd: string,
  changelist: number
): Promise<PerforceSubmittedFile[]> {
  const result = await runP4OrThrow(['-ztag', 'describe', '-s', String(changelist)], { cwd })
  const files: PerforceSubmittedFile[] = []
  for (const record of parseTaggedOutput(result)) {
    for (let index = 0; record[`depotFile${index}`] !== undefined; index += 1) {
      const depotPath = record[`depotFile${index}`]
      if (depotPath) {
        files.push({ depotPath, action: toAction(record[`action${index}`]) })
      }
    }
  }
  return files
}
