import '../unused-default-rpc-methods.test-fixture'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { runProcess } from '@orca/process-host'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { RpcDispatcher } from '../dispatcher'
import { PERFORCE_METHODS } from './perforce'
import { getHostedPerforceFolderDiff } from '../../../perforce/perforce-hosted-diff'
import type {
  PerforceHistoryEntry,
  PerforceOperationResult,
  PerforceStatusResult
} from '../../../../shared/perforce/perforce-types'

/**
 * Drives every perforce.* RPC method against a real Perforce server, the way orcad serves an SSH
 * workspace. Opt in with ORCA_P4_TEST_PORT (e.g. localhost:1666); ORCA_P4_TEST_USER and
 * ORCA_P4_TEST_BIN override the OS user and the p4 on PATH. Each run uses its own client and
 * depot path, so existing workspaces are untouched.
 */
const port = process.env.ORCA_P4_TEST_PORT ?? ''
const user = process.env.ORCA_P4_TEST_USER ?? userInfo().username
const p4Bin = process.env.ORCA_P4_TEST_BIN ?? 'p4'
const run = randomBytes(4).toString('hex')
const client = `orca-rpc-test-${run}`
const depotRoot = `//depot/orca-rpc-test/${run}`
const WORKTREE = 'id:p4-repo::rpc-test'

let root = ''
let dispatcher: RpcDispatcher
let seq = 0

async function p4(args: string[], input?: string): Promise<string> {
  const result = await runProcess({
    program: p4Bin,
    args: ['-p', port, '-u', user, '-c', client, ...args],
    cwd: root || undefined,
    input,
    timeoutMs: 30_000
  })
  if (result.code !== 0) {
    throw new Error(`p4 ${args.join(' ')} failed: ${result.stderr || result.stdout}`)
  }
  return result.stdout
}

async function rpc<T>(operation: string, params: Record<string, unknown> = {}): Promise<T> {
  const response = await dispatcher.dispatch({
    id: `p4-${(seq += 1)}`,
    authToken: 'token',
    method: `perforce.${operation}`,
    params: {
      worktree: WORKTREE,
      settings: {
        p4Path: p4Bin === 'p4' ? '' : p4Bin,
        p4Port: port,
        p4User: user,
        p4Client: client
      },
      ...params
    }
  })
  if (!response.ok) {
    throw new Error(`perforce.${operation} failed: ${JSON.stringify(response)}`)
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: each assertion below checks the shape the backend documents.
  return (response as { result: T }).result
}

async function ok(operation: string, params: Record<string, unknown> = {}): Promise<string> {
  const result = await rpc<PerforceOperationResult>(operation, params)
  expect(result, `perforce.${operation}: ${result.error ?? ''}`).toMatchObject({ success: true })
  return result.output
}

async function status(): Promise<PerforceStatusResult> {
  return rpc<PerforceStatusResult>('status')
}

function opened(s: PerforceStatusResult, path: string) {
  return s.entries.find((entry) => entry.path === path && entry.group === 'opened')
}

describe.skipIf(!port)('perforce.* RPC methods against a real Perforce server', () => {
  beforeAll(async () => {
    root = realpathSync(await mkdtemp(join(tmpdir(), 'orca-p4-rpc-')))
    await p4(
      ['client', '-i'],
      [
        `Client: ${client}`,
        `Owner: ${user}`,
        `Root: ${root}`,
        'Options: noallwrite noclobber nocompress unlocked nomodtime normdir',
        'LineEnd: local',
        'View:',
        `\t${depotRoot}/... //${client}/...`,
        ''
      ].join('\n')
    )
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the methods only call resolveRuntimeFileTarget and getRuntimeId.
    const runtime = {
      getRuntimeId: () => 'p4-test-runtime',
      resolveRuntimeFileTarget: async () => ({
        worktree: { path: root },
        executionHostId: 'local'
      })
    } as unknown as OrcaRuntimeService
    dispatcher = new RpcDispatcher({ runtime, methods: PERFORCE_METHODS })
  }, 60_000)

  afterAll(async () => {
    if (!root) {
      return
    }
    try {
      await p4(['revert', '-k', '//...']).catch(() => '')
      const pending = await p4(['-ztag', 'changes', '-s', 'pending', '-c', client]).catch(() => '')
      for (const [, change] of pending.matchAll(/^\.\.\. change (\d+)$/gm)) {
        await p4(['shelve', '-d', '-c', change!]).catch(() => '')
        await p4(['change', '-d', change!]).catch(() => '')
      }
      await p4(['client', '-d', client]).catch(() => '')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 60_000)

  it('detects the workspace and reports its connection', async () => {
    const detected = await rpc<{ isWorkspace: boolean; info?: { client: string } }>('detect')
    expect(detected).toMatchObject({ isWorkspace: true, info: { client } })
    const info = await rpc<{ success: boolean; info?: { client: string; root: string } }>('info')
    expect(info).toMatchObject({ success: true, info: { client } })
  })

  it('lists new files, adds them, submits, and records history', async () => {
    await writeFile(join(root, 'a.txt'), 'alpha\n')
    await writeFile(join(root, 'b.txt'), 'bravo\n')
    const before = await status()
    expect(
      before.entries
        .filter((e) => e.group === 'new')
        .map((e) => e.path)
        .sort()
    ).toEqual(['a.txt', 'b.txt'])

    await ok('open', { filePaths: ['a.txt', 'b.txt'] })
    const added = await status()
    expect(opened(added, 'a.txt')).toMatchObject({ action: 'add', changelist: 'default' })
    expect(opened(added, 'b.txt')).toMatchObject({ action: 'add' })

    await ok('submit', { changelist: 'default', message: `Initial files ${run}` })
    const after = await status()
    expect(after.entries).toEqual([])
    const history = await rpc<PerforceHistoryEntry[]>('history', { limit: 5 })
    expect(history.some((entry) => entry.description.includes(`Initial files ${run}`))).toBe(true)
  })

  it('opens a read-only synced file for edit on demand', async () => {
    expect(await rpc<boolean>('isReadOnlyFile', { filePath: 'a.txt' })).toBe(true)
    await rpc('checkoutIfReadOnly', { filePath: 'a.txt' })
    expect(await rpc<boolean>('isReadOnlyFile', { filePath: 'a.txt' })).toBe(false)
    expect(opened(await status(), 'a.txt')).toMatchObject({ action: 'edit' })
  })

  it('diffs an edited file through the RPC method and the hosted git.diff path', async () => {
    await writeFile(join(root, 'a.txt'), 'alpha\nadded line\n')
    const diff = await rpc<{ kind: string; originalContent?: string; modifiedContent?: string }>(
      'diff',
      { filePath: 'a.txt' }
    )
    expect(diff).toMatchObject({
      originalContent: 'alpha\n',
      modifiedContent: 'alpha\nadded line\n'
    })
    const patch = await rpc<string>('diffText', { filePaths: ['a.txt'] })
    expect(patch).toContain('+added line')

    // The hosted git.diff path uses the host's own p4 environment, as orcad does on an SSH host.
    const saved = {
      P4PORT: process.env.P4PORT,
      P4USER: process.env.P4USER,
      P4CLIENT: process.env.P4CLIENT
    }
    Object.assign(process.env, { P4PORT: port, P4USER: user, P4CLIENT: client })
    try {
      const hosted = await getHostedPerforceFolderDiff(
        {
          executionHostId: 'local',
          worktree: { path: root },
          // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only the folder kind is read.
          repo: { kind: 'folder', path: root } as never
        },
        'a.txt'
      )
      expect(hosted).toMatchObject({ modifiedContent: 'alpha\nadded line\n' })
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = value
        }
      }
    }
  })

  it('creates, renames, shelves, unshelves and deletes a changelist', async () => {
    const created = await rpc<PerforceOperationResult & { changelist?: number }>(
      'createChangelist',
      { description: `Feature ${run}`, filePaths: ['a.txt'] }
    )
    expect(created.success).toBe(true)
    const change = created.changelist!
    expect(opened(await status(), 'a.txt')).toMatchObject({ changelist: change })

    await ok('editDescription', { changelist: change, description: `Feature ${run} v2` })
    expect((await status()).changelists.find((c) => c.id === change)?.description).toContain(
      `Feature ${run} v2`
    )

    await ok('shelve', { changelist: change })
    const shelved = (await status()).changelists.find((c) => c.id === change)
    expect(shelved?.shelvedFiles.map((f) => f.path)).toEqual(['a.txt'])

    await ok('discard', { entries: [{ path: 'a.txt', group: 'opened', action: 'edit' }] })
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('alpha\n')
    await ok('unshelve', { changelist: change })
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('alpha\nadded line\n')

    await ok('deleteShelf', { changelist: change })
    expect((await status()).changelists.find((c) => c.id === change)?.shelvedFiles).toEqual([])

    await ok('moveToChangelist', { filePaths: ['a.txt'], changelist: 'default' })
    expect(opened(await status(), 'a.txt')).toMatchObject({ changelist: 'default' })
    await ok('deleteChangelist', { changelist: change })
    expect((await status()).changelists.some((c) => c.id === change)).toBe(false)
  })

  it('shelves and reverts files, then unshelves them by depot path and from another changelist', async () => {
    const created = await rpc<PerforceOperationResult & { changelist?: number }>(
      'createChangelist',
      { description: `Shelf work ${run}`, filePaths: ['a.txt'] }
    )
    const change = created.changelist!
    await ok('shelveAndRevertFiles', { changelist: change, filePaths: ['a.txt'] })
    expect(opened(await status(), 'a.txt')).toBeUndefined()
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('alpha\n')

    await ok('unshelveFiles', { changelist: change, depotPaths: [`${depotRoot}/a.txt`] })
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('alpha\nadded line\n')
    await ok('discard', { entries: [{ path: 'a.txt', group: 'opened', action: 'edit' }] })

    await ok('unshelveFrom', { sourceChangelist: change, changelist: 'default' })
    expect(opened(await status(), 'a.txt')).toMatchObject({ changelist: 'default' })
    await ok('discard', { entries: [{ path: 'a.txt', group: 'opened', action: 'edit' }] })

    await ok('deleteChangelistWithFiles', { changelist: change })
    expect((await status()).changelists.some((c) => c.id === change)).toBe(false)
  })

  it('opens and closes files for edit and syncs the workspace', async () => {
    await ok('edit', { filePaths: ['b.txt'] })
    expect(opened(await status(), 'b.txt')).toMatchObject({ action: 'edit' })
    await ok('close', { filePaths: ['b.txt'] })
    expect(opened(await status(), 'b.txt')).toBeUndefined()
    await ok('sync')
  })

  it('finds the workspace .p4config by default, with no settings or P4 environment', async () => {
    await writeFile(join(root, '.p4config'), `P4PORT=${port}\nP4USER=${user}\nP4CLIENT=${client}\n`)
    const saved = Object.fromEntries(
      ['P4CONFIG', 'P4PORT', 'P4USER', 'P4CLIENT', 'P4ENVIRO'].map((key) => [key, process.env[key]])
    )
    for (const key of Object.keys(saved)) {
      delete process.env[key]
    }
    // Why: a developer's `p4 set P4CONFIG` (~/.p4enviro) would find the file without discovery.
    process.env.P4ENVIRO = join(root, 'no-p4enviro')
    try {
      // status/info always reach the server; detect would answer from its per-directory cache.
      for (const method of ['perforce.status', 'perforce.info']) {
        const response = await dispatcher.dispatch({
          id: `p4config-default-${method}`,
          authToken: 'token',
          method,
          params: { worktree: WORKTREE, settings: p4Bin === 'p4' ? {} : { p4Path: p4Bin } }
        })
        expect(response, method).toMatchObject({ ok: true })
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: ok responses carry a result.
        const result = (response as { result: { info?: { client?: string } } }).result
        expect(result.info?.client, method).toBe(client)
      }
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = value
        }
      }
      await rm(join(root, '.p4config'), { force: true })
    }
  })

  it('rejects unsafe arguments before p4 runs', async () => {
    const response = await dispatcher.dispatch({
      id: 'unsafe',
      authToken: 'token',
      method: 'perforce.edit',
      params: { worktree: WORKTREE, filePaths: ['../outside.txt'] }
    })
    expect(response.ok).toBe(false)
  })
})
