import { existsSync, mkdtempSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type * as Os from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SecretStore } from '../../shared/secret-store'
import type { FeishuBitableConnection } from '../../shared/feishu-bitable-types'

let tempHome = ''

const PLAINTEXT_SECRET_STORE: SecretStore = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`enc:${value}`),
  decryptString: (value) => {
    const text = value.toString('utf-8')
    if (!text.startsWith('enc:')) {
      throw new Error('not encrypted')
    }
    return text.slice(4)
  },
  describeProtectionGap: () => null
}

// Why control bytes: a decrypt failure falls back to legacy plaintext decoding,
// which refuses control characters — only then does the read throw.
const SEALED_SECRET_STORE: SecretStore = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.concat([Buffer.from([0, 1]), Buffer.from(value)]),
  decryptString: (value) => {
    const bytes = value.subarray(0, 2)
    if (bytes[0] !== 0 || bytes[1] !== 1) {
      throw new Error('not encrypted')
    }
    return value.toString('utf-8', 2)
  },
  describeProtectionGap: () => null
}

// Why inside loadStore: vi.resetModules() gives secret-store a fresh singleton,
// so the mock must be installed on that instance, not the pre-reset import.
function loadStore(secretStore: SecretStore = PLAINTEXT_SECRET_STORE) {
  vi.resetModules()
  vi.doMock('node:os', async () => {
    const actual = await vi.importActual<typeof Os>('node:os')
    return { ...actual, homedir: () => tempHome }
  })
  return (async () => {
    const { setSecretStore } = await import('../../shared/secret-store')
    setSecretStore(secretStore)
    return import('./connection-store')
  })()
}

function connection(overrides: Partial<FeishuBitableConnection> = {}): FeishuBitableConnection {
  return {
    id: 'conn-1',
    label: 'Team board',
    appId: 'cli_app',
    appToken: 'app-token-a',
    tableId: 'tbl-alpha',
    viewId: null,
    fieldMapping: {
      titleField: '标题',
      descriptionField: null,
      acceptanceCriteriaField: null,
      urlField: null
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    lastValidatedAt: null,
    ...overrides
  }
}

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), 'orca-feishu-store-'))
})

afterEach(() => {
  vi.doUnmock('node:os')
  vi.restoreAllMocks()
})

describe('feishu bitable connection store', () => {
  it('round-trips a connection with its encrypted secret at mode 0600', async () => {
    const store = await loadStore()
    store.upsertConnection(connection(), 'secret-one')

    const registryPath = join(tempHome, '.orca', 'feishu-bitable-connections.json')
    expect(existsSync(registryPath)).toBe(true)
    expect(statSync(registryPath).mode & 0o077).toBe(0)
    const secretPath = join(
      tempHome,
      '.orca',
      'feishu-bitable-tokens',
      `${Buffer.from('conn-1').toString('base64url')}.enc`
    )
    expect(readFileSync(secretPath, 'utf-8')).toBe('enc:secret-one')

    expect(store.getConnectionFile().connections).toHaveLength(1)
    expect(store.readSecret('conn-1')).toBe('secret-one')
  })

  it('drops connections whose secret file disappeared at read time', async () => {
    const store = await loadStore()
    store.upsertConnection(connection(), 'secret-one')
    // Simulate a lost secret: remove the encrypted file, then re-read from disk.
    unlinkSync(
      join(
        tempHome,
        '.orca',
        'feishu-bitable-tokens',
        `${Buffer.from('conn-1').toString('base64url')}.enc`
      )
    )
    store.resetConnectionStoreCacheForTest()
    expect(store.getConnectionFile().connections).toHaveLength(0)
    expect(store.getStatus().connected).toBe(false)
  })

  it('keeps the last connection active and repairs a dangling active id', async () => {
    const store = await loadStore()
    store.upsertConnection(connection(), 'secret-one')
    store.upsertConnection(connection({ id: 'conn-2', label: 'Ops board' }), 'secret-two')
    expect(store.getStatus().activeConnectionId).toBe('conn-2')

    store.removeConnection('conn-2')
    expect(store.getStatus().activeConnectionId).toBe('conn-1')

    store.selectConnection(null)
    expect(store.getStatus().activeConnectionId).toBe('conn-1')
    store.selectConnection('not-a-connection')
    expect(store.getStatus().activeConnectionId).toBe('conn-1')
  })

  it('persists field mapping updates and rejects unknown connections', async () => {
    const store = await loadStore()
    store.upsertConnection(connection(), 'secret-one')

    const updated = store.updateFieldMapping('conn-1', {
      titleField: '新标题',
      descriptionField: '细节',
      acceptanceCriteriaField: null,
      urlField: null
    })
    expect(updated?.fieldMapping.titleField).toBe('新标题')
    expect(store.getConnection('conn-1')?.fieldMapping.descriptionField).toBe('细节')

    expect(
      store.updateFieldMapping('missing', {
        titleField: null,
        descriptionField: null,
        acceptanceCriteriaField: null,
        urlField: null
      })
    ).toBeNull()
  })

  it('reports a decrypt failure through status instead of throwing forever', async () => {
    const store = await loadStore(SEALED_SECRET_STORE)
    store.upsertConnection(connection(), 'secret-one')
    store.resetConnectionStoreCacheForTest()

    // Flip to a store that cannot decrypt the sealed bytes the previous one wrote.
    const locked: SecretStore = {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.concat([Buffer.from([0, 1]), Buffer.from(value)]),
      decryptString: () => {
        throw new Error('safeStorage locked')
      },
      describeProtectionGap: () => null
    }
    const reloaded = await loadStore(locked)
    expect(() => reloaded.readSecret('conn-1')).toThrow()
    expect(reloaded.getStatus().credentialError).toBeTruthy()
  })

  it('never exposes the secret through status payloads', async () => {
    const store = await loadStore()
    store.upsertConnection(connection(), 'secret-one')
    const json = JSON.stringify(store.getStatus())
    expect(json).not.toContain('secret-one')
  })
})
