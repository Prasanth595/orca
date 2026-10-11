import { lstatSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { lockSync } from 'proper-lockfile'
import { withFileTransactionLock } from '../file-transaction-lock'
import { getOrcaUserDataPath } from './codex-home-paths'
import { parseCodexRolloutThreadId } from './codex-rollout-identity'
import { isWslUncPath } from '../../shared/wsl-paths'
import { writeFileAtomically } from '../codex-accounts/fs-utils'

const mutations = new Map<string, Promise<unknown>>()
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isCodexSessionUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

function recordPath(
  sessionId: string,
  suffix: 'tombstone' | 'pending' | 'complete' = 'tombstone'
): string {
  if (!isCodexSessionUuid(sessionId)) {
    throw new Error('Invalid Codex session UUID')
  }
  return join(
    getOrcaUserDataPath(),
    'codex-session-deletions',
    `${sessionId.toLowerCase()}.${suffix}`
  )
}

export function isCodexSessionDeletionRecorded(sessionId: unknown, complete = false): boolean {
  if (!isCodexSessionUuid(sessionId)) {
    return false
  }
  return complete
    ? recordExists(sessionId, 'complete')
    : recordExists(sessionId, 'tombstone') || recordExists(sessionId, 'pending')
}

function recordExists(sessionId: string, suffix: 'tombstone' | 'pending' | 'complete'): boolean {
  try {
    lstatSync(recordPath(sessionId, suffix))
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false
    }
    throw error
  }
}

export function recordCodexSessionDeletion(
  sessionId: string,
  complete = false,
  homes: readonly string[] = []
): void {
  const path = recordPath(sessionId, complete ? 'complete' : 'pending')
  mkdirSync(join(getOrcaUserDataPath(), 'codex-session-deletions'), {
    recursive: true,
    mode: 0o700
  })
  writeFileAtomically(recordPath(sessionId), '{}', { mode: 0o600 })
  writeFileAtomically(path, JSON.stringify({ homes }), { mode: 0o600 })
  if (complete) {
    try {
      unlinkSync(recordPath(sessionId, 'pending'))
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
        throw error
      }
    }
  }
}

export function pendingCodexSessionDeletionHomes(sessionId: string): string[] {
  if (!recordExists(sessionId, 'pending')) {
    return []
  }
  const record: unknown = JSON.parse(readFileSync(recordPath(sessionId, 'pending'), 'utf8'))
  if (
    !record ||
    typeof record !== 'object' ||
    !('homes' in record) ||
    !Array.isArray(record.homes) ||
    !record.homes.every((home): home is string => typeof home === 'string')
  ) {
    throw new Error('Invalid Codex session deletion record')
  }
  return record.homes
}

export function isCodexRolloutDeletionRecorded(filePath: string, complete = false): boolean {
  if (isWslUncPath(filePath)) {
    return false
  }
  const rollout = parseCodexRolloutThreadId(filePath)
  return rollout !== null && isCodexSessionDeletionRecorded(rollout.threadId, complete)
}

export async function createCodexRolloutVisibilityPredicate(): Promise<
  (filePath: string) => boolean
> {
  let entries: string[]
  try {
    entries = await readdir(join(getOrcaUserDataPath(), 'codex-session-deletions'))
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      throw error
    }
    entries = []
  }
  const completed = new Set(
    entries
      .filter((entry) => entry.endsWith('.complete'))
      .map((entry) => entry.slice(0, -'.complete'.length).toLowerCase())
      .filter(isCodexSessionUuid)
  )
  return (filePath) => {
    if (isWslUncPath(filePath)) {
      return true
    }
    const rollout = parseCodexRolloutThreadId(filePath)
    return rollout === null || !completed.has(rollout.threadId)
  }
}

export async function withCodexSessionHistoryMutation<T>(
  sessionId: string,
  operation: () => Promise<T>,
  options: { onBusy?: () => T } = {}
): Promise<T> {
  const key = sessionId.toLowerCase()
  const previous = mutations.get(key)
  if (previous && options.onBusy) {
    return options.onBusy()
  }
  const task = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(() =>
    isCodexSessionUuid(sessionId)
      ? withFileTransactionLock(recordPath(sessionId), operation, {
          retries: options.onBusy ? 0 : undefined
        })
      : operation()
  )
  mutations.set(key, task)
  try {
    return await task
  } catch (error) {
    if (options.onBusy && error instanceof Error && 'code' in error && error.code === 'ELOCKED') {
      return options.onBusy()
    }
    throw error
  } finally {
    if (mutations.get(key) === task) {
      mutations.delete(key)
    }
  }
}

export function withCodexRolloutPublication<T>(filePath: string, skipped: T, publish: () => T): T {
  const rollout = parseCodexRolloutThreadId(filePath)
  if (!rollout || isWslUncPath(filePath)) {
    return publish()
  }
  if (isCodexSessionDeletionRecorded(rollout.threadId)) {
    return skipped
  }
  const path = recordPath(rollout.threadId)
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  let release: () => void
  try {
    release = lockSync(path, { realpath: false, retries: 0 })
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ELOCKED') {
      return skipped
    }
    throw error
  }
  try {
    return isCodexSessionDeletionRecorded(rollout.threadId) ? skipped : publish()
  } finally {
    release()
  }
}
