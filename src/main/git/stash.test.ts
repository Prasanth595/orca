import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { runProcess } from '@orca/process-host'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ runner: vi.fn(), invalidate: vi.fn() }))
vi.mock('./runner', () => ({ gitExecFileAsync: mocks.runner }))
vi.mock('./status', () => ({
  runWithGitReadCacheInvalidation: async (run: () => Promise<unknown>) => {
    mocks.invalidate()
    try {
      return await run()
    } finally {
      mocks.invalidate()
    }
  }
}))
import { gitStash, listGitStashes } from './stash'
import { clearGitCapabilityStateForTests } from './git-capability-state'

let repo = ''
async function git(args: string[], cwd = repo) {
  const result = await runProcess({ program: 'git', args, cwd })
  if (result.code !== 0) {
    throw Object.assign(new Error(result.stderr || result.stdout), result)
  }
  return result
}

describe('stash operations with real Git', () => {
  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), 'orca-stash-'))
    clearGitCapabilityStateForTests()
    mocks.runner.mockReset()
    mocks.invalidate.mockClear()
    mocks.runner.mockImplementation((args: string[], options?: { cwd?: string }) =>
      git(args, options?.cwd)
    )
    await git(['init', '-q'])
    await git(['config', 'user.name', 'Stash Test'])
    await git(['config', 'user.email', 'stash@example.invalid'])
    await git(['config', 'commit.gpgsign', 'false'])
    await git(['config', 'core.autocrlf', 'false'])
    await writeFile(join(repo, 'tracked.txt'), 'base\n')
    await writeFile(join(repo, 'other.txt'), 'other base\n')
    await git(['add', '.'])
    await git(['commit', '-qm', 'initial'])
  })
  afterEach(async () => {
    if (!resolve(repo).startsWith(resolve(tmpdir()) + sep)) {
      throw new Error('Unexpected test directory')
    }
    await rm(repo, { recursive: true, force: true })
  })

  it('saves tracked changes and leaves untracked files for regular Stash', async () => {
    await writeFile(join(repo, 'tracked.txt'), 'edited\n')
    await writeFile(join(repo, 'new.txt'), 'new\n')
    await gitStash(repo, { action: 'push', message: 'my work' })
    expect(await readFile(join(repo, 'tracked.txt'), 'utf8')).toBe('base\n')
    expect(await readFile(join(repo, 'new.txt'), 'utf8')).toBe('new\n')
    const { entries } = await listGitStashes(repo)
    expect(entries[0]?.subject).toContain('my work')
    await gitStash(repo, { action: 'pop', stash: entries[0] })
    expect(await readFile(join(repo, 'tracked.txt'), 'utf8')).toBe('edited\n')
    expect((await listGitStashes(repo)).entries).toEqual([])
  })

  it('saves and views untracked files, applies without dropping, and drops the selected stash', async () => {
    await writeFile(join(repo, 'tracked.txt'), 'edited\n')
    await writeFile(join(repo, 'new.txt'), 'new contents\n')
    await gitStash(repo, { action: 'push_untracked' })
    await expect(readFile(join(repo, 'new.txt'))).rejects.toThrow()
    const stash = (await listGitStashes(repo)).entries[0]
    const view = await gitStash(repo, { action: 'show', stash })
    expect(view.output).toContain('+edited')
    expect(view.output).toContain('+new contents')
    expect(view.output).toContain('new.txt')
    await gitStash(repo, { action: 'apply', stash })
    expect(await readFile(join(repo, 'new.txt'), 'utf8')).toBe('new contents\n')
    expect((await listGitStashes(repo)).entries).toHaveLength(1)
    await gitStash(repo, { action: 'drop', stash })
    expect((await listGitStashes(repo)).entries).toEqual([])
  })

  it('stashes staged changes while preserving unrelated unstaged edits', async () => {
    await writeFile(join(repo, 'tracked.txt'), 'staged\n')
    await git(['add', 'tracked.txt'])
    await writeFile(join(repo, 'other.txt'), 'unstaged\n')
    await gitStash(repo, { action: 'push_staged' })
    expect(await readFile(join(repo, 'tracked.txt'), 'utf8')).toBe('base\n')
    expect(await readFile(join(repo, 'other.txt'), 'utf8')).toBe('unstaged\n')
    expect((await git(['diff', '--cached', '--name-only'])).stdout).toBe('')
  })

  it('preserves the stash and refreshes caches when Pop encounters conflicts', async () => {
    await writeFile(join(repo, 'tracked.txt'), 'stashed version\n')
    await gitStash(repo, { action: 'push' })
    await writeFile(join(repo, 'tracked.txt'), 'committed version\n')
    await git(['commit', '-qam', 'new version'])
    const stash = (await listGitStashes(repo)).entries[0]
    mocks.invalidate.mockClear()
    await expect(gitStash(repo, { action: 'pop', stash })).rejects.toThrow()
    expect((await listGitStashes(repo)).entries[0]?.oid).toBe(stash?.oid)
    expect((await git(['status', '--porcelain'])).stdout).toContain('UU tracked.txt')
    expect(mocks.invalidate).toHaveBeenCalledTimes(2)
  })

  it('refuses stale selections and stale Drop All confirmations', async () => {
    await writeFile(join(repo, 'tracked.txt'), 'first\n')
    await gitStash(repo, { action: 'push' })
    const original = (await listGitStashes(repo)).entries[0]
    await writeFile(join(repo, 'tracked.txt'), 'second\n')
    await gitStash(repo, { action: 'push' })
    await expect(gitStash(repo, { action: 'drop', stash: original })).rejects.toThrow(
      'stash list changed'
    )
    await expect(
      gitStash(repo, { action: 'clear', expectedStashes: original ? [original.oid] : [] })
    ).rejects.toThrow('stash list changed')
    const current = await listGitStashes(repo)
    expect(current.entries).toHaveLength(2)
    await gitStash(repo, {
      action: 'clear',
      expectedStashes: current.entries.map((entry) => entry.oid)
    })
    expect((await listGitStashes(repo)).entries).toEqual([])
  })

  it('serializes stash deletion across worktrees so concurrent requests cannot delete a different entry', async () => {
    const linked = join(repo, 'linked')
    await git(['worktree', 'add', '-b', 'stash-linked', linked])
    await writeFile(join(repo, 'tracked.txt'), 'older\n')
    await gitStash(repo, { action: 'push' })
    await writeFile(join(repo, 'tracked.txt'), 'latest\n')
    await gitStash(repo, { action: 'push' })
    const [latest, older] = (await listGitStashes(repo)).entries
    const results = await Promise.allSettled([
      gitStash(repo, { action: 'drop', stash: latest }),
      gitStash(linked, { action: 'drop', stash: latest })
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect((await listGitStashes(repo)).entries.map((entry) => entry.oid)).toEqual([older?.oid])
  })
})

describe('Stash Staged capability cache', () => {
  beforeEach(() => {
    clearGitCapabilityStateForTests()
    mocks.runner.mockReset()
  })
  it('remembers unsupported options per execution host and shares concurrent probes', async () => {
    mocks.runner.mockRejectedValue(new Error("error: unknown option `staged'"))
    await Promise.all([
      expect(gitStash('/repo', { action: 'push_staged' })).rejects.toThrow('Git 2.35'),
      expect(gitStash('/repo2', { action: 'push_staged' })).rejects.toThrow('Git 2.35')
    ])
    await expect(gitStash('/repo', { action: 'push_staged' })).rejects.toThrow('Git 2.35')
    expect(
      mocks.runner.mock.calls.filter(([args]) => Array.isArray(args) && args[0] === 'stash')
    ).toHaveLength(1)
    await expect(
      gitStash('/repo', { action: 'push_staged' }, { wslDistro: 'Ubuntu' })
    ).rejects.toThrow('Git 2.35')
    expect(
      mocks.runner.mock.calls.filter(([args]) => Array.isArray(args) && args[0] === 'stash')
    ).toHaveLength(2)
  })
  it('does not turn operational failures into unsupported capability verdicts', async () => {
    mocks.runner.mockRejectedValue(new Error('fatal: Unable to create index.lock'))
    await expect(gitStash('/repo', { action: 'push_staged' })).rejects.toThrow('index.lock')
    await expect(gitStash('/repo', { action: 'push_staged' })).rejects.toThrow('index.lock')
    expect(
      mocks.runner.mock.calls.filter(([args]) => Array.isArray(args) && args[0] === 'stash')
    ).toHaveLength(2)
  })
})
