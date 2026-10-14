#!/usr/bin/env node
// Fork-only (TW199501/orca): fast-forward release to origin/dev, push release, and optionally build a local macOS app.
// Usage: node config/scripts/zh-hant-sync-release.mjs [--no-push] [--build-mac]
import { execFileSync, spawnSync } from 'node:child_process'
import { readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'

// Why: release only ever fast-forwards to the dev that was pushed and tested, never a local dev.
const SOURCE_REF = 'origin/dev'
const TARGET_BRANCH = 'release'
// Why: pnpm keeps re-adding @pnpm/exe here locally; it must never be committed or block a checkout.
const LOCKFILE_NOISE = 'pnpm-lock.yaml'

const args = new Set(process.argv.slice(2))
const push = !args.has('--no-push')
const buildMac = args.has('--build-mac')
const root = resolve(
  execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
)
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

function git(gitArgs, options = {}) {
  return (
    execFileSync('git', gitArgs, { cwd: root, encoding: 'utf8', ...options })
      ?.toString()
      // Why: trimEnd only — porcelain status lines start with a meaningful space.
      .trimEnd() ?? ''
  )
}

function run(command, commandArgs, env = {}) {
  console.log(`$ ${command} ${commandArgs.join(' ')}`)
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...env }
  })
  return result.status ?? 1
}

class SyncAbort extends Error {}

// Why: throw instead of process.exit so the finally block can switch back to the start branch.
function fail(message) {
  throw new SyncAbort(message)
}

function assertCleanTree() {
  const dirty = git(['status', '--porcelain', '--untracked-files=no'])
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3))
  if (dirty.includes(LOCKFILE_NOISE)) {
    git(['restore', LOCKFILE_NOISE])
  }
  const blocking = dirty.filter((file) => file !== LOCKFILE_NOISE)
  if (blocking.length > 0) {
    fail(`Commit or stash these changes first:\n  ${blocking.join('\n  ')}`)
  }
}

function syncRelease() {
  if (run('git', ['fetch', 'origin']) !== 0) {
    fail('git fetch origin failed.')
  }
  git(['switch', TARGET_BRANCH], { stdio: 'inherit' })
  if (run('git', ['merge', '--ff-only', `origin/${TARGET_BRANCH}`]) !== 0) {
    fail(
      `Local ${TARGET_BRANCH} has commits that are not on origin/${TARGET_BRANCH}. Stop and check.`
    )
  }
  const releaseOnly = git(['log', '--oneline', `${SOURCE_REF}..${TARGET_BRANCH}`])
  if (releaseOnly) {
    fail(
      `${TARGET_BRANCH} has commits that are not on ${SOURCE_REF}:\n${releaseOnly}\n` +
        `Get them into dev through a PR first; never commit to ${TARGET_BRANCH}.`
    )
  }
  const incoming = git(['log', '--oneline', `${TARGET_BRANCH}..${SOURCE_REF}`])
  if (incoming) {
    console.log(`\nCommits ${SOURCE_REF} brings into ${TARGET_BRANCH}:\n${incoming}\n`)
    if (run('git', ['merge', '--ff-only', SOURCE_REF]) !== 0) {
      fail(`Fast-forwarding ${TARGET_BRANCH} to ${SOURCE_REF} failed. Stop and check.`)
    }
    console.log(`\n✓ ${TARGET_BRANCH} fast-forwarded to ${git(['log', '--oneline', '-1'])}`)
  }
  // Why: an earlier --no-push run may have fast-forwarded the local branch already.
  const remoteRef = `origin/${TARGET_BRANCH}`
  const unpushed = git(['log', '--oneline', `${remoteRef}..${TARGET_BRANCH}`])
  if (!unpushed) {
    console.log(`\n✓ ${remoteRef} already matches ${SOURCE_REF}.`)
    return
  }
  if (!push) {
    console.log(`\n--no-push: ${TARGET_BRANCH} is ahead of ${remoteRef} locally only.`)
    return
  }
  if (run('git', ['push', 'origin', TARGET_BRANCH]) !== 0) {
    fail(`Push failed. ${TARGET_BRANCH} is updated locally; push it manually.`)
  }
}

function buildMacApp() {
  if (process.platform !== 'darwin') {
    fail('--build-mac only works on macOS. On Windows run: pnpm build:win')
  }
  const distDir = join(root, 'dist')
  // Why: stale artifacts from earlier builds are easy to install by mistake.
  for (const entry of safeReaddir(distDir)) {
    rmSync(join(distDir, entry), { recursive: true, force: true })
  }
  for (const step of [
    'build:desktop',
    'build:computer-macos',
    'build:keyboard-layout-macos',
    'build:notification-status-macos',
    'ensure:electron-runtime'
  ]) {
    if (run(pnpm, ['run', step], { ORCA_BACKGROUND_LAUNCH: '1' }) !== 0) {
      fail(`pnpm run ${step} failed.`)
    }
  }
  const commit = git(['rev-parse', '--short=12', 'HEAD'])
  const { version } = JSON.parse(git(['show', 'HEAD:package.json']))
  const localVersion = `${version}-local.${Date.now()}.${commit}`
  const arch = process.arch === 'arm64' ? '--arm64' : '--x64'
  // Why: a plain `pnpm install` has only host-arch native modules, so build just this Mac's arch.
  // electron-builder still reports the other arch as failed after this one is written.
  run(
    pnpm,
    ['exec', 'electron-builder', '--config', 'config/electron-builder.config.cjs', '--mac', arch],
    {
      ORCA_BACKGROUND_LAUNCH: '1',
      ORCA_BUILD_COMMIT: commit,
      ORCA_LOCAL_BUILD_VERSION: localVersion
    }
  )
  rmSync(join(distDir, 'builder-debug.yml'), { force: true })
  const dmg = safeReaddir(distDir).find((entry) => entry.endsWith('.dmg'))
  if (!dmg) {
    fail('No .dmg was produced; see the electron-builder output above.')
  }
  console.log(`\n✓ ${localVersion}\n  ${join(distDir, dmg)}`)
}

function safeReaddir(dir) {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

try {
  const startBranch = git(['branch', '--show-current'])
  assertCleanTree()
  try {
    syncRelease()
    if (buildMac) {
      buildMacApp()
    }
  } finally {
    if (startBranch && git(['branch', '--show-current']) !== startBranch) {
      assertCleanTree()
      git(['switch', startBranch], { stdio: 'inherit' })
    }
  }
} catch (error) {
  if (!(error instanceof SyncAbort)) {
    throw error
  }
  console.error(`\n✗ ${error.message}`)
  process.exitCode = 1
}
