import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  isPlaneConnectionId,
  isPlaneUuid,
  normalizePlaneWorkspaceSlug
} from '../../shared/plane-ids'
import type {
  PlaneConnection,
  PlaneConnectionFile,
  PlaneProjectScope,
  PlaneViewer
} from '../../shared/plane-types'
import type { SecretAtRestProtection } from '../../shared/secret-at-rest-protection'
import { readCredentialFileProtection } from '../credential-file-protection'
import { writeCredentialFileAtomic, writeEncryptedCredential } from '../integration-credential-file'
import { createIntegrationStateFileCache } from '../integration-state-file-cache'
import { createIntegrationTokenFileCache } from '../integration-token-file-cache'

function getOrcaDir(): string {
  return join(homedir(), '.orca')
}

function getConnectionFilePath(): string {
  return join(getOrcaDir(), 'plane-connections.json')
}

function getTokenDir(): string {
  return join(getOrcaDir(), 'plane-tokens')
}

// Why validate: the id becomes a file name, so a hand-edited file must not reach other paths.
export function getPlaneTokenPath(connectionId: string): string {
  if (!isPlaneConnectionId(connectionId)) {
    throw new Error('Invalid Plane connection id')
  }
  return join(getTokenDir(), `${connectionId}.enc`)
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** An http(s) origin plus optional path prefix, with no credentials, query, hash or trailing slash. */
function isPlaneBaseUrl(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false
  }
  try {
    const url = new URL(value)
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      !url.username &&
      !url.password &&
      value === `${url.protocol}//${url.host}${url.pathname.replace(/\/$/, '')}`
    )
  } catch {
    return false
  }
}

function normalizeViewer(value: unknown): PlaneViewer | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id) {
    return null
  }
  return {
    id: value.id,
    displayName: typeof value.displayName === 'string' ? value.displayName : value.id,
    email: typeof value.email === 'string' ? value.email : null
  }
}

/** Anything but a usable scope reads as null ("choose projects"), never as 'all'. */
export function normalizePlaneProjectScope(value: unknown): PlaneProjectScope | null {
  if (!isRecord(value)) {
    return null
  }
  if (value.mode === 'all') {
    return { mode: 'all' }
  }
  if (value.mode !== 'selected' || !Array.isArray(value.projectIds)) {
    return null
  }
  const ids = value.projectIds
  if (ids.length === 0 || !ids.every(isPlaneUuid)) {
    return null
  }
  const projectIds = [...new Set(ids.map((id) => id.toLowerCase()))]
  return { mode: 'selected', projectIds }
}

function normalizeConnection(value: unknown): PlaneConnection | null {
  if (!isRecord(value)) {
    return null
  }
  const viewer = normalizeViewer(value.viewer)
  const workspaceSlug = normalizePlaneWorkspaceSlug(value.workspaceSlug)
  if (
    !isPlaneConnectionId(value.id) ||
    (value.hostKind !== 'cloud' && value.hostKind !== 'self-hosted') ||
    !isPlaneBaseUrl(value.apiBaseUrl) ||
    !isPlaneBaseUrl(value.webBaseUrl) ||
    !workspaceSlug ||
    workspaceSlug !== value.workspaceSlug ||
    !viewer
  ) {
    return null
  }
  return {
    id: value.id,
    hostKind: value.hostKind,
    apiBaseUrl: value.apiBaseUrl,
    webBaseUrl: value.webBaseUrl,
    workspaceSlug,
    viewer,
    projectScope: normalizePlaneProjectScope(value.projectScope),
    ...(value.insecureHttpAcknowledged === true ? { insecureHttpAcknowledged: true } : {}),
    connectedAt:
      typeof value.connectedAt === 'number' && Number.isFinite(value.connectedAt)
        ? value.connectedAt
        : 0
  }
}

function emptyFile(): PlaneConnectionFile {
  return { version: 1, activeConnectionId: null, connections: [] }
}

/** Drops invalid entries and connections whose token is gone. */
export function normalizePlaneConnectionFile(
  value: unknown,
  hasToken: (connectionId: string) => boolean
): PlaneConnectionFile {
  if (!isRecord(value) || !Array.isArray(value.connections)) {
    return emptyFile()
  }
  const seen = new Set<string>()
  const connections = value.connections.flatMap((entry) => {
    const connection = normalizeConnection(entry)
    if (!connection || seen.has(connection.id) || !hasToken(connection.id)) {
      return []
    }
    seen.add(connection.id)
    return [connection]
  })
  const active = connections.find((c) => c.id === value.activeConnectionId) ?? connections[0]
  return { version: 1, activeConnectionId: active?.id ?? null, connections }
}

const tokenFileCache = createIntegrationTokenFileCache({
  service: 'Plane',
  filePath: getPlaneTokenPath
})

function readConnectionFileFromDisk(): unknown {
  try {
    return JSON.parse(readFileSync(getConnectionFilePath(), 'utf-8'))
  } catch {
    return null
  }
}

const connectionFileCache = createIntegrationStateFileCache({
  filePath: getConnectionFilePath,
  readFromDisk: readConnectionFileFromDisk
})

export function hasPlaneToken(connectionId: string): boolean {
  return isPlaneConnectionId(connectionId) && tokenFileCache.has(connectionId)
}

export function readPlaneConnectionFile(): PlaneConnectionFile {
  return normalizePlaneConnectionFile(connectionFileCache.get(), hasPlaneToken)
}

export function writePlaneConnectionFile(file: PlaneConnectionFile): void {
  ensureDir(getOrcaDir())
  const next = normalizePlaneConnectionFile(file, hasPlaneToken)
  writeCredentialFileAtomic(getConnectionFilePath(), Buffer.from(JSON.stringify(next, null, 2)))
  connectionFileCache.invalidate()
}

/** A saved connection by id, or the active one when no id is given. */
export function getPlaneConnection(connectionId?: string): PlaneConnection | null {
  const file = readPlaneConnectionFile()
  const id = connectionId ?? file.activeConnectionId
  return file.connections.find((c) => c.id === id) ?? null
}

/** Throws CredentialDecryptionError when the sealed token cannot be opened. */
export function readPlaneToken(connectionId: string): string | null {
  return tokenFileCache.read(connectionId)
}

export function getPlaneCredentialError(connectionId: string): string | undefined {
  return tokenFileCache.error(connectionId)
}

/** Never decrypts, so reading status cannot raise a keychain prompt. */
export function getPlaneTokenProtection(connectionId: string): SecretAtRestProtection | null {
  return readCredentialFileProtection(getPlaneTokenPath(connectionId))
}

export function savePlaneToken(connectionId: string, apiToken: string): void {
  ensureDir(getOrcaDir())
  ensureDir(getTokenDir())
  writeEncryptedCredential('Plane', getPlaneTokenPath(connectionId), apiToken)
  tokenFileCache.forget(connectionId)
}

export function deletePlaneToken(connectionId: string): void {
  tokenFileCache.forget(connectionId)
  try {
    unlinkSync(getPlaneTokenPath(connectionId))
  } catch {
    // Already gone.
  }
}
