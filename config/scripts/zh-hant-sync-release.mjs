#!/usr/bin/env node
// Fork-only (TW199501/orca): merge dev into release, push both, and optionally build a local macOS app.
// Usage: node config/scripts/zh-hant-sync-release.mjs [--no-push] [--build-mac]
import { execFileSync, spawnSync } from 'node:child_process'
import { readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'

const SOURCE_BRANCH = 'dev'
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

function fail(message) {
  console.error(`\n✗ ${message}`)
  process.exit(1)
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
  git(['switch', TARGET_BRANCH], { stdio: 'inherit' })
  if (run('git', ['merge', '--no-edit', SOURCE_BRANCH]) !== 0) {
    fail(`Merge conflict on ${TARGET_BRANCH}. Resolve it, commit, then rerun.`)
  }
  console.log(
    `\n✓ ${SOURCE_BRANCH} merged into ${TARGET_BRANCH}: ${git(['log', '--oneline', '-1'])}`
  )
  if (push && run('git', ['push', 'origin', SOURCE_BRANCH, TARGET_BRANCH]) !== 0) {
    fail('Push failed. The merge is kept locally; push manually.')
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
