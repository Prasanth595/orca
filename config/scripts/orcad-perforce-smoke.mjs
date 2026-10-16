/**
 * Boots the BUILT orcad (`pnpm build:orcad`), pairs a real client to it, registers a Perforce
 * workspace as a folder project, and drives the perforce.* RPC methods and the hosted git.diff
 * path over the real transport — the same route an SSH workspace takes.
 *
 * Usage: node config/scripts/orcad-perforce-smoke.mjs --workspace <p4 client root> [--file <rel>]
 * The workspace must be a working p4 client (P4CONFIG or p4 set). The only mutation is an
 * `edit` followed by `discard` (revert) of --file, which leaves the workspace as it was.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import process from 'node:process'
import { ORCAD_SERVER_ENTRY_FILENAME } from '../../src/shared/orcad-artifacts.ts'
import { packagedNodeRuntimePath } from './build-orcad-node.mjs'
import { currentTarget } from './server-build-target.mjs'

const projectDir = resolve(import.meta.dirname, '../..')
const ORCAD_DIR = join(projectDir, 'out', 'orcad')
const READY_TIMEOUT_MS = 120_000
const PORT = 6900 + Math.floor(Math.random() * 90)

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}

function log(message) {
  process.stdout.write(`[orcad-perforce-smoke] ${message}\n`)
}

function check(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
  log(`ok: ${message}`)
}

function waitForReady(child) {
  return new Promise((resolvePromise, rejectPromise) => {
    let buffered = ''
    let stderr = ''
    const timer = setTimeout(
      () => rejectPromise(new Error('orcad never signalled ready')),
      READY_TIMEOUT_MS
    )
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      buffered += chunk
      for (const line of buffered.split('\n')) {
        if (!line.startsWith('{')) {
          continue
        }
        try {
          const payload = JSON.parse(line)
          if (payload.type === 'orca_server_ready') {
            clearTimeout(timer)
            resolvePromise(payload)
            return
          }
        } catch {
          // Partial line; wait for the rest.
        }
      }
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      rejectPromise(new Error(`orcad exited with ${code} before ready:\n${stderr.trim()}`))
    })
  })
}

async function main() {
  const workspace = resolve(arg('workspace', ''))
  const file = arg('file', 'README.md')
  if (!arg('workspace', '')) {
    throw new Error('--workspace <p4 client root> is required')
  }
  const serverData = mkdtempSync(join(tmpdir(), 'orcad-p4-server-'))
  const clientData = mkdtempSync(join(tmpdir(), 'orcad-p4-client-'))
  const child = spawn(
    packagedNodeRuntimePath(ORCAD_DIR, currentTarget()),
    [join(ORCAD_DIR, ORCAD_SERVER_ENTRY_FILENAME), '--port', String(PORT), '--json'],
    { env: { ...process.env, ORCA_USER_DATA: serverData }, stdio: ['ignore', 'pipe', 'pipe'] }
  )
  try {
    const ready = await waitForReady(child)
    const code = new URL(ready.pairing.url).searchParams.get('code')
    log(`orcad ready on port ${PORT}`)
    const { RuntimeClient } = await import(
      pathToFileURL(join(projectDir, 'out', 'cli', 'runtime', 'client.js')).href
    )
    const client = new RuntimeClient(clientData, 60_000, code)
    const call = async (method, params) => (await client.call(method, params)).result

    const { repo } = await call('repo.add', { path: workspace, kind: 'folder' })
    const { worktrees } = await call('worktree.list', { repo: `id:${repo.id}` })
    const worktree = worktrees.find((candidate) => candidate.repoId === repo.id) ?? worktrees[0]
    check(Boolean(worktree?.id), `folder project registered (${repo.id})`)
    const selector = `id:${worktree.id}`
    const p4 = (operation, params = {}) =>
      call(`perforce.${operation}`, { worktree: selector, ...params })

    const detected = await p4('detect')
    check(detected.isWorkspace === true, `perforce.detect sees client ${detected.info?.client}`)
    const info = await p4('info')
    check(info.success && info.info.root.length > 0, `perforce.info root ${info.info?.root}`)
    const status = await p4('status')
    check(
      Array.isArray(status.entries),
      `perforce.status: ${status.entries.length} entries, ${status.changelists.length} pending changelists`
    )
    const history = await p4('history', { limit: 3 })
    check(history.length > 0, `perforce.history: latest change ${history[0]?.change}`)
    check(
      (await p4('isReadOnlyFile', { filePath: file })) === true,
      `${file} is read-only until opened`
    )

    const before = status.entries.some((entry) => entry.path === file && entry.group === 'opened')
    if (before) {
      log(`skipping edit/close: ${file} is already opened`)
    } else {
      const edited = await p4('edit', { filePaths: [file] })
      check(edited.success, `perforce.edit opened ${file}`)
      const opened = await p4('status')
      check(
        opened.entries.some((entry) => entry.path === file && entry.group === 'opened'),
        `perforce.status shows ${file} opened`
      )
      const diff = await call('git.diff', { worktree: selector, filePath: file, staged: false })
      check(
        typeof diff.originalContent === 'string',
        'git.diff on orcad answers from p4 for a Perforce folder'
      )
      // discard is a real revert: unlike close (revert -k) it restores the read-only synced file.
      const reverted = await p4('discard', {
        entries: [{ path: file, group: 'opened', action: 'edit' }]
      })
      check(reverted.success, `perforce.discard reverted ${file}`)
      const after = await p4('status')
      check(
        !after.entries.some((entry) => entry.path === file && entry.group === 'opened'),
        `${file} is no longer opened`
      )
      check((await p4('isReadOnlyFile', { filePath: file })) === true, `${file} is read-only again`)
    }
    log('PASS')
  } finally {
    const exited = new Promise((resolveExit) => child.once('exit', resolveExit))
    child.kill('SIGTERM')
    // orcad flushes its profile on shutdown; removing the directory first races that write.
    await Promise.race([exited, new Promise((r) => setTimeout(r, 15_000))])
    rmSync(serverData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    rmSync(clientData, { recursive: true, force: true })
  }
}

main().catch((error) => {
  process.stderr.write(`[orcad-perforce-smoke] FAIL: ${error.stack ?? error}\n`)
  process.exitCode = 1
})
