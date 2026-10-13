import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readCredentialFileProtection } from '../credential-file-protection'
import type { SecretAtRestProtection } from '../../shared/secret-at-rest-protection'
import {
  CredentialDecryptionError,
  credentialFileHasContent,
  readStoredCredentialToken,
  writeEncryptedCredential
} from '../integration-credential-file'
import {
  normalizeFeishuBitableFieldMapping,
  type FeishuBitableConnection,
  type FeishuBitableConnectionStatus,
  type FeishuBitableFieldMapping
} from '../../shared/feishu-bitable-types'

export type FeishuBitableConnectionFile = {
  version: 1
  activeConnectionId: string | null
  connections: FeishuBitableConnection[]
}

let cachedFile: FeishuBitableConnectionFile | null = null
let fileLoaded = false
const cachedSecrets = new Map<string, string>()
// Why: decrypt failures are recorded per connection so getStatus can explain
// failing reads without re-touching the keychain on every status poll.
export const credentialErrors = new Map<string, string>()

function getOrcaDir(): string {
  return join(homedir(), '.orca')
}

function getConnectionFilePath(): string {
  return join(getOrcaDir(), 'feishu-bitable-connections.json')
}

function getSecretDir(): string {
  return join(getOrcaDir(), 'feishu-bitable-tokens')
}

function getSecretPath(connectionId: string): string {
  return join(getSecretDir(), `${Buffer.from(connectionId).toString('base64url')}.enc`)
}

function ensureDir(path: string): void {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true })
  }
}

export function hasStoredSecret(connectionId: string): boolean {
  return cachedSecrets.has(connectionId) || credentialFileHasContent(getSecretPath(connectionId))
}

function emptyFile(): FeishuBitableConnectionFile {
  return { version: 1, activeConnectionId: null, connections: [] }
}

function nullableTrimmed(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeConnection(input: unknown): FeishuBitableConnection | null {
  if (!input || typeof input !== 'object') {
    return null
  }
  const record: Record<string, unknown> = Object.fromEntries(Object.entries(input))
  if (
    typeof record.id !== 'string' ||
    typeof record.label !== 'string' ||
    typeof record.appId !== 'string' ||
    typeof record.appToken !== 'string' ||
    typeof record.tableId !== 'string' ||
    typeof record.createdAt !== 'string'
  ) {
    return null
  }
  return {
    id: record.id,
    label: record.label,
    appId: record.appId,
    appToken: record.appToken,
    tableId: record.tableId,
    viewId: nullableTrimmed(record.viewId),
    fieldMapping: normalizeFeishuBitableFieldMapping(record.fieldMapping),
    createdAt: record.createdAt,
    lastValidatedAt: nullableTrimmed(record.lastValidatedAt)
  }
}

function readConnectionFileFromDisk(): FeishuBitableConnectionFile {
  const path = getConnectionFilePath()
  if (!existsSync(path)) {
    return emptyFile()
  }
  try {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: trusted local registry file; normalizeConnection re-validates every entry field-by-field and drops anything malformed.
    const parsed = JSON.parse(
      readFileSync(path, { encoding: 'utf-8' })
    ) as Partial<FeishuBitableConnectionFile>
    const connections = Array.isArray(parsed.connections)
      ? parsed.connections
          .map((connection) => normalizeConnection(connection))
          .filter((connection): connection is FeishuBitableConnection => connection !== null)
          .filter((connection) => hasStoredSecret(connection.id))
      : []
    const activeConnectionId =
      typeof parsed.activeConnectionId === 'string' &&
      connections.some((connection) => connection.id === parsed.activeConnectionId)
        ? parsed.activeConnectionId
        : (connections[0]?.id ?? null)
    return { version: 1, activeConnectionId, connections }
  } catch {
    return emptyFile()
  }
}

export function getConnectionFile(): FeishuBitableConnectionFile {
  if (!fileLoaded || !cachedFile) {
    cachedFile = readConnectionFileFromDisk()
    fileLoaded = true
  }
  return cachedFile
}

export function writeConnectionFile(file: FeishuBitableConnectionFile): void {
  ensureDir(getOrcaDir())
  const connections = file.connections.filter((connection) => hasStoredSecret(connection.id))
  const activeConnectionId =
    file.activeConnectionId && connections.some((c) => c.id === file.activeConnectionId)
      ? file.activeConnectionId
      : (connections[0]?.id ?? null)
  cachedFile = { version: 1, activeConnectionId, connections }
  fileLoaded = true
  writeFileSync(getConnectionFilePath(), JSON.stringify(cachedFile, null, 2), {
    encoding: 'utf-8',
    mode: 0o600
  })
}

export function readSecret(connectionId: string): string | null {
  const cached = cachedSecrets.get(connectionId)
  if (cached !== undefined) {
    return cached
  }
  const path = getSecretPath(connectionId)
  if (!existsSync(path)) {
    return null
  }
  try {
    const raw = readFileSync(path)
    const secret = readStoredCredentialToken('Feishu Bitable', raw)
    if (secret) {
      cachedSecrets.set(connectionId, secret)
    }
    credentialErrors.delete(connectionId)
    return secret
  } catch (error) {
    if (error instanceof CredentialDecryptionError) {
      credentialErrors.set(connectionId, error.message)
      throw error
    }
    return null
  }
}

export function saveSecret(connectionId: string, appSecret: string): void {
  ensureDir(getOrcaDir())
  ensureDir(getSecretDir())
  writeEncryptedCredential('Feishu Bitable', getSecretPath(connectionId), appSecret)
  cachedSecrets.set(connectionId, appSecret)
  credentialErrors.delete(connectionId)
}

export function deleteSecret(connectionId: string): void {
  cachedSecrets.delete(connectionId)
  credentialErrors.delete(connectionId)
  try {
    unlinkSync(getSecretPath(connectionId))
  } catch {
    // Secret may not exist — safe to ignore.
  }
}

/** How a connection's stored secret sits on disk, or null when none is stored. */
export function getConnectionSecretProtection(connectionId: string): SecretAtRestProtection | null {
  return readCredentialFileProtection(getSecretPath(connectionId))
}

export function getConnection(connectionId: string): FeishuBitableConnection | null {
  return (
    getConnectionFile().connections.find((connection) => connection.id === connectionId) ?? null
  )
}

export function upsertConnection(
  connection: FeishuBitableConnection,
  secret: string
): FeishuBitableConnection {
  const file = getConnectionFile()
  const next: FeishuBitableConnectionFile = {
    version: 1,
    activeConnectionId: connection.id,
    connections: [...file.connections.filter((entry) => entry.id !== connection.id), connection]
  }
  saveSecret(connection.id, secret)
  writeConnectionFile(next)
  return connection
}

export function updateFieldMapping(
  connectionId: string,
  fieldMapping: FeishuBitableFieldMapping
): FeishuBitableConnection | null {
  const file = getConnectionFile()
  const existing = file.connections.find((entry) => entry.id === connectionId)
  if (!existing) {
    return null
  }
  const updated: FeishuBitableConnection = { ...existing, fieldMapping }
  writeConnectionFile({
    version: 1,
    activeConnectionId: file.activeConnectionId,
    connections: file.connections.map((entry) => (entry.id === connectionId ? updated : entry))
  })
  return updated
}

export function removeConnection(connectionId: string): void {
  const file = getConnectionFile()
  deleteSecret(connectionId)
  const connections = file.connections.filter((entry) => entry.id !== connectionId)
  writeConnectionFile({
    version: 1,
    activeConnectionId:
      file.activeConnectionId === connectionId
        ? (connections[0]?.id ?? null)
        : file.activeConnectionId,
    connections
  })
}

export function getStatus(): FeishuBitableConnectionStatus {
  const file = getConnectionFile()
  const credentialError = file.connections
    .map((connection) => credentialErrors.get(connection.id))
    .find((message): message is string => Boolean(message))
  const protections = file.connections
    .map((connection) => getConnectionSecretProtection(connection.id))
    .filter((protection): protection is SecretAtRestProtection => protection !== null)
  return {
    connected: file.connections.length > 0,
    connections: file.connections,
    activeConnectionId: file.activeConnectionId,
    ...(credentialError ? { credentialError } : {}),
    ...(protections.length > 0
      ? { credentialProtection: protections.includes('plaintext') ? 'plaintext' : 'sealed' }
      : {})
  }
}

export function selectConnection(connectionId: string | null): FeishuBitableConnectionStatus {
  const file = getConnectionFile()
  const next =
    connectionId && file.connections.some((entry) => entry.id === connectionId)
      ? connectionId
      : (file.connections[0]?.id ?? null)
  writeConnectionFile({ version: 1, activeConnectionId: next, connections: file.connections })
  return getStatus()
}

/** Test-only: reset in-memory caches so temp-HOME tests see a clean store. */
export function resetConnectionStoreCacheForTest(): void {
  cachedFile = null
  fileLoaded = false
  cachedSecrets.clear()
  credentialErrors.clear()
}
