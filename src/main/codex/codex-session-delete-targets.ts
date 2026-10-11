import { lstat, realpath } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
  isPathInsideOrEqual,
  normalizeRuntimePathForComparison
} from '../../shared/cross-platform-path'
import { isWslUncPath } from '../../shared/wsl-paths'
import { configuredAdditionalCodexHomePaths } from '../ai-vault/cached-session-list'
import { codexHomeSessionsDir } from '../ai-vault/session-scanner-roots'
import { getCodexAccountHomeSessionDirectories } from './codex-account-home-discovery'
import { getSystemCodexHomePath, resolveOrcaManagedCodexHomePath } from './codex-home-paths'
import { parseCodexRolloutThreadId } from './codex-rollout-identity'
import { readCodexRolloutSessionMetaId } from './codex-rollout-session-meta'
import { listCodexSessionRolloutFilesIncrementally } from './codex-session-file-listing'

export function codexSessionDeletionHomes(): string[] {
  return [
    ...new Set(
      [
        getSystemCodexHomePath(),
        dirname(codexHomeSessionsDir()),
        resolveOrcaManagedCodexHomePath(),
        ...getCodexAccountHomeSessionDirectories().map((root) => dirname(root)),
        ...configuredAdditionalCodexHomePaths()
      ]
        .filter((home) => !isWslUncPath(home))
        .map((home) => resolve(home))
    )
  ]
}

export async function assertCodexSessionDeletionPath(
  home: string,
  filePath: string
): Promise<void> {
  const root = ['sessions', 'archived_sessions']
    .map((name) => join(home, name))
    .find((candidate) => isPathInsideOrEqual(candidate, filePath))
  const stat = await lstat(filePath)
  if (!root || !stat.isFile() || !(await lstat(root)).isDirectory()) {
    throw new Error('Invalid Codex session file')
  }
  const canonicalHome = await realpath(home)
  const canonicalRoot = await realpath(root)
  if (
    normalizeRuntimePathForComparison(canonicalRoot) !==
      normalizeRuntimePathForComparison(
        join(canonicalHome, root === join(home, 'sessions') ? 'sessions' : 'archived_sessions')
      ) ||
    !isPathInsideOrEqual(canonicalRoot, await realpath(dirname(filePath)))
  ) {
    throw new Error('Codex session path escapes its home')
  }
  if (!stat.isFile() || !isPathInsideOrEqual(canonicalRoot, await realpath(filePath))) {
    throw new Error('Codex deletion does not support symlink rollouts')
  }
}

export async function collectCodexSessionDeletionHomes(
  sessionId: string,
  homes: readonly string[],
  onRollout?: (filePath: string) => void
): Promise<string[]> {
  const matched: string[] = []
  for (const home of homes) {
    let found = false
    for (const name of ['sessions', 'archived_sessions']) {
      const root = join(home, name)
      try {
        if (!(await lstat(root)).isDirectory()) {
          throw new Error('Invalid Codex sessions root')
        }
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
          continue
        }
        throw error
      }
      for await (const filePath of listCodexSessionRolloutFilesIncrementally(
        root,
        { yieldMs: 0, includeSymlinkFiles: true },
        (directoryPath, error) => {
          if (
            directoryPath === root &&
            error instanceof Error &&
            'code' in error &&
            error.code === 'ENOENT'
          ) {
            return
          }
          throw error
        }
      )) {
        if (parseCodexRolloutThreadId(filePath)?.threadId !== sessionId) {
          continue
        }
        await assertCodexSessionDeletionPath(home, filePath)
        if ((await readCodexRolloutSessionMetaId(filePath))?.toLowerCase() !== sessionId) {
          throw new Error('Codex session identity could not be verified')
        }
        onRollout?.(filePath)
        found = true
      }
    }
    if (found) {
      matched.push(home)
    }
  }
  return matched
}

export async function planCodexSessionDeletionHomes(
  sessionId: string,
  homes: readonly string[],
  pending: readonly string[],
  selectedHome: string,
  onRollout: (filePath: string) => void
): Promise<string[]> {
  const canonicalHomes = new Map<string, string>()
  const discovered = await collectCodexSessionDeletionHomes(sessionId, homes, onRollout)
  const candidates = [...new Set([...pending, ...discovered])]
  candidates.sort((a, b) => Number(a === selectedHome) - Number(b === selectedHome))
  for (const home of candidates) {
    let canonical: string
    try {
      canonical = await realpath(home)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        continue
      }
      throw error
    }
    if (!homes.includes(home)) {
      throw new Error('An existing Codex home is no longer registered')
    }
    if (home === selectedHome) {
      canonicalHomes.delete(canonical)
    }
    if (!canonicalHomes.has(canonical)) {
      canonicalHomes.set(canonical, home)
    }
  }
  const targets = [...canonicalHomes.values()]
  return targets
}
