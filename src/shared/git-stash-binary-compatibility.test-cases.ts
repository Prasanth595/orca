import { writeFile, mkdir, rm } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { expect, it } from 'vitest'
import { isStashStagedUnsupportedError } from './git-stash-capability'

export function registerGitStashBinaryCompatibilityCases(
  runGit: (args: string[]) => Promise<{ stdout: string; stderr: string }>,
  getRepoPath: () => string,
  supports: (major: number, minor: number) => boolean,
  image: boolean
): void {
  it('supports stash round trips on Git 2.25 and recognizes the Git 2.35 staged boundary', async () => {
    const directory = join(getRepoPath(), 'stash-compat')
    if (!resolve(directory).startsWith(resolve(getRepoPath()) + sep)) {
      throw new Error('Unexpected compatibility test directory')
    }
    const cwd = image ? '/repo/stash-compat' : directory
    await mkdir(directory)
    const git = (args: string[]) => runGit(['-C', cwd, ...args])
    try {
      await git(['init', '-q'])
      await git(['config', 'user.name', 'Stash Compatibility'])
      await git(['config', 'user.email', 'stash@example.invalid'])
      await writeFile(join(directory, 'file.txt'), 'base\n')
      await git(['add', '.'])
      await git(['commit', '-qm', 'initial'])
      await writeFile(join(directory, 'file.txt'), 'staged\n')
      await git(['add', '.'])
      try {
        await git(['stash', 'push', '--staged'])
        expect(supports(2, 35)).toBe(true)
        await git(['stash', 'pop'])
      } catch (error) {
        expect(supports(2, 35)).toBe(false)
        expect(isStashStagedUnsupportedError(error)).toBe(true)
      }
      await writeFile(join(directory, 'new.txt'), 'new\n')
      await git(['stash', 'push', '--include-untracked', '--message', 'compatibility'])
      expect(
        (await git(['stash', 'list', '--max-count=201', '--format=%gd%x00%H%x00%s'])).stdout
      ).toContain('compatibility')
      expect(
        (await git(['stash', 'show', '--patch', '--no-ext-diff', '--no-color', 'stash@{0}'])).stdout
      ).toContain('+staged')
      const parents = (await git(['rev-list', '--parents', '--max-count=1', 'stash@{0}'])).stdout
        .trim()
        .split(' ')
      expect(parents[3]).toBeTruthy()
      expect(
        (
          await git([
            'diff-tree',
            '--root',
            '--no-commit-id',
            '--patch',
            '--no-ext-diff',
            '--no-color',
            parents[3] ?? ''
          ])
        ).stdout
      ).toContain('+new')
      await git(['stash', 'apply', 'stash@{0}'])
      await git(['stash', 'drop', 'stash@{0}'])
      await git(['stash', 'push'])
      await git(['stash', 'clear'])
      expect((await git(['stash', 'list'])).stdout).toBe('')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
}
