import { mkdirSync, readFileSync, renameSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import { isAgentRunAccountId, type AgentRunAccountProvider } from '../../shared/agent-run-account'
import { isDefinitiveAbsence } from '../../shared/definitive-filesystem-absence'
import { writeFileAtomically } from '../codex-accounts/fs-utils'
import { PersistRetryBackoff } from '../persist-retry-backoff'

/** A conversation a person kept on an account. Only explicit keeps are stored. */
export type KeptConversation = {
  lane: string
  accountId: string | null
  keptAt: number
  transcriptPath?: string
}

type KeptConversationsFile = {
  version: 1
  conversations: Record<string, KeptConversation>
}

type Mutation =
  | { kind: 'keep'; key: string; entry: KeptConversation }
  | { kind: 'release'; key: string; keptAt?: number }
  | { kind: 'release-account'; provider: AgentRunAccountProvider; accountId: string }

const PRUNE_MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000

function conversationKey(provider: AgentRunAccountProvider, sessionId: string): string {
  return `${provider}:${sessionId}`
}

function readEntry(value: unknown): KeptConversation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  const lane = 'lane' in value ? value.lane : undefined
  const accountId = 'accountId' in value ? value.accountId : undefined
  const keptAt = 'keptAt' in value ? value.keptAt : undefined
  const transcriptPath = 'transcriptPath' in value ? value.transcriptPath : undefined
  if (
    (lane !== 'host' && !(typeof lane === 'string' && /^wsl:.{1,256}$/.test(lane))) ||
    (accountId !== null && !isAgentRunAccountId(accountId)) ||
    typeof keptAt !== 'number' ||
    !Number.isFinite(keptAt)
  ) {
    return null
  }
  return {
    lane,
    accountId,
    keptAt,
    ...(typeof transcriptPath === 'string' && transcriptPath.length <= 4096
      ? { transcriptPath }
      : {})
  }
}

/** 'unsupported' = another build's version, which this one must neither read nor overwrite. */
function parseFile(raw: string): Map<string, KeptConversation> | 'corrupt' | 'unsupported' {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return 'corrupt'
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return 'corrupt'
  }
  if (!('version' in parsed) || parsed.version !== 1) {
    return 'unsupported'
  }
  const conversations = 'conversations' in parsed ? parsed.conversations : undefined
  if (!conversations || typeof conversations !== 'object' || Array.isArray(conversations)) {
    return 'corrupt'
  }
  const entries = new Map<string, KeptConversation>()
  for (const [key, value] of Object.entries(conversations)) {
    const entry = readEntry(value)
    if (entry && /^(claude|codex):./.test(key)) {
      entries.set(key, entry)
    }
  }
  return entries
}

/** Conversations kept on an account, by session id; an unreadable file is 'unavailable', never empty. */
export class KeptAgentConversations {
  private entries: Map<string, KeptConversation> | null = null
  private readonly queue: Mutation[] = []
  private needsWrite = false
  private readonly retry = new PersistRetryBackoff(() => this.flush())
  private reportedCorruption = false

  constructor(private readonly deps: { filePath: string; now?: () => number }) {}

  get(
    provider: AgentRunAccountProvider,
    sessionId: string
  ): KeptConversation | null | 'unavailable' {
    const entries = this.load()
    return entries ? (entries.get(conversationKey(provider, sessionId)) ?? null) : 'unavailable'
  }

  keep(provider: AgentRunAccountProvider, sessionId: string, entry: KeptConversation): void {
    this.queue.push({ kind: 'keep', key: conversationKey(provider, sessionId), entry })
    this.flush()
  }

  release(provider: AgentRunAccountProvider, sessionId: string): void {
    this.queue.push({ kind: 'release', key: conversationKey(provider, sessionId) })
    this.flush()
  }

  /** Releases every conversation kept on an account; returns how many were released now. */
  releaseAccount(provider: AgentRunAccountProvider, accountId: string): number {
    const before = this.entries?.size ?? 0
    this.queue.push({ kind: 'release-account', provider, accountId })
    this.flush()
    return this.entries && this.queue.length === 0 ? before - this.entries.size : 0
  }

  /** Drops keeps whose transcript is definitively gone, since they can no longer resume. */
  async pruneUnreachable(): Promise<void> {
    const entries = this.load()
    if (!entries) {
      return
    }
    const cutoff = (this.deps.now ?? Date.now)() - PRUNE_MIN_AGE_MS
    for (const [key, entry] of entries) {
      if (!entry.transcriptPath || entry.keptAt >= cutoff) {
        continue
      }
      try {
        // Why one at a time: this runs at startup, where a burst of stats would compete with launch.
        await stat(entry.transcriptPath)
      } catch (error) {
        if (isDefinitiveAbsence(error)) {
          // Why keptAt: a keep made while this stat was pending is newer and must stay.
          this.queue.push({ kind: 'release', key, keptAt: entry.keptAt })
        }
      }
    }
    if (this.queue.length > 0) {
      this.flush()
    }
  }

  private load(): Map<string, KeptConversation> | null {
    if (this.entries) {
      return this.entries
    }
    let raw: string
    try {
      raw = readFileSync(this.deps.filePath, 'utf-8')
    } catch (error) {
      if (!isDefinitiveAbsence(error)) {
        return null
      }
      this.entries = new Map()
      return this.entries
    }
    const parsed = parseFile(raw)
    if (parsed === 'unsupported') {
      return null
    }
    if (parsed === 'corrupt') {
      return this.setAsideUnreadableFile()
    }
    this.entries = parsed
    return parsed
  }

  // Why rename, not overwrite: the bytes stay on disk for anyone who needs them back.
  private setAsideUnreadableFile(): Map<string, KeptConversation> | null {
    try {
      renameSync(this.deps.filePath, `${this.deps.filePath}.corrupt-${Date.now()}`)
    } catch (error) {
      if (!isDefinitiveAbsence(error)) {
        return null
      }
    }
    if (!this.reportedCorruption) {
      this.reportedCorruption = true
      console.warn('[kept-conversations] Set aside an unreadable kept-conversations file')
    }
    this.entries = new Map()
    return this.entries
  }

  private flush(): void {
    const entries = this.load()
    if (!entries) {
      this.retry.schedule()
      return
    }
    for (const mutation of this.queue.splice(0)) {
      this.needsWrite = applyMutation(entries, mutation) || this.needsWrite
    }
    if (!this.needsWrite) {
      this.retry.clear()
      return
    }
    try {
      mkdirSync(dirname(this.deps.filePath), { recursive: true })
      const file: KeptConversationsFile = {
        version: 1,
        conversations: Object.fromEntries(entries)
      }
      writeFileAtomically(this.deps.filePath, `${JSON.stringify(file)}\n`, { mode: 0o600 })
      this.needsWrite = false
      this.retry.clear()
    } catch (error) {
      console.warn('[kept-conversations] Failed to persist kept conversations:', error)
      this.retry.schedule()
    }
  }
}

function applyMutation(entries: Map<string, KeptConversation>, mutation: Mutation): boolean {
  if (mutation.kind === 'keep') {
    const existing = entries.get(mutation.key)
    if (
      existing?.lane === mutation.entry.lane &&
      existing.accountId === mutation.entry.accountId &&
      existing.transcriptPath === mutation.entry.transcriptPath
    ) {
      return false
    }
    entries.set(mutation.key, mutation.entry)
    return true
  }
  if (mutation.kind === 'release') {
    const existing = entries.get(mutation.key)
    return mutation.keptAt === undefined || existing?.keptAt === mutation.keptAt
      ? entries.delete(mutation.key)
      : false
  }
  let changed = false
  for (const [key, entry] of entries) {
    if (key.startsWith(`${mutation.provider}:`) && entry.accountId === mutation.accountId) {
      entries.delete(key)
      changed = true
    }
  }
  return changed
}
