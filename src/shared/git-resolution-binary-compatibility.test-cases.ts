import { expect, it } from 'vitest'
import { gitCredentialPromptGuardEnv } from './git-credential-prompt-env'
import { resolveConfiguredGitPushTarget } from './git-push-target-resolution'
import {
  resolveDefaultBaseRefViaExec,
  resolveRemoteHeadBranchViaExec
} from './git-default-base-ref'
import { buildGitSshPolicyEnv, GIT_SSH_CONFIG_ARGS, parseGitSshConfig } from './git-ssh-policy-env'

export function registerGitResolutionBinaryCompatibilityCases(
  runGit: (args: string[], env?: NodeJS.ProcessEnv) => Promise<{ stdout: string; stderr: string }>,
  resolveRemotePath: (name: string) => string,
  supports: (major: number, minor: number) => boolean
): void {
  it('quietly distinguishes present and absent branch refs', async () => {
    const head = (await runGit(['rev-parse', 'HEAD'])).stdout.trim()
    await runGit(['branch', 'quiet-probe-present', head])
    await expect(
      runGit(['rev-parse', '--verify', '--quiet', 'refs/heads/quiet-probe-present'])
    ).resolves.toMatchObject({ stdout: `${head}\n`, stderr: '' })
    await expect(
      runGit(['rev-parse', '--verify', '--quiet', 'refs/heads/quiet-probe-absent'])
    ).rejects.toMatchObject({ code: 1, stdout: '', stderr: '' })
  })

  it('degrades indexed credential config safely at the Git 2.31 boundary', async () => {
    const guardEnv = gitCredentialPromptGuardEnv({}, 'linux')
    await expect(runGit(['status', '--short'], guardEnv)).resolves.toBeDefined()

    try {
      const result = await runGit(['config', '--get', 'credential.interactive'], guardEnv)
      expect(supports(2, 31)).toBe(true)
      expect(result.stdout.trim()).toBe('false')
    } catch {
      // Git 2.25 ignores the indexed variables rather than rejecting commands;
      // the scalar prompt guards still provide the baseline fail-fast behavior.
      expect(supports(2, 31)).toBe(false)
    }
  })

  // Why pin this: --verify swallows --end-of-options but --symbolic-full-name echoes
  // it deliberately, on every version tested (2.25 through 2.49). git-history.ts skips
  // that line; if a future git stopped emitting it, the skip stays correct, but if this
  // assertion ever flips the reason for the skip is worth re-reading.
  it('echoes the option marker from rev-parse --symbolic-full-name', async () => {
    const result = await runGit(['rev-parse', '--symbolic-full-name', '--end-of-options', 'HEAD'])
    const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean)

    expect(lines[0]).toBe('--end-of-options')
    expect(lines.find((line) => line !== '--end-of-options')).toMatch(/^refs\//)
  })

  it('resolves push config from one snapshot and refreshes after a config write', async () => {
    const branch = (await runGit(['symbolic-ref', '--quiet', '--short', 'HEAD'])).stdout.trim()
    await runGit(['config', `branch.${branch}.remote`, 'fork'])
    await runGit(['config', `branch.${branch}.merge`, `refs/heads/${branch}`])
    const calls: string[][] = []
    const exec = async (args: string[]) => {
      calls.push(args)
      return runGit(args)
    }

    await expect(resolveConfiguredGitPushTarget(exec)).resolves.toEqual({
      remote: 'fork',
      refspec: `HEAD:${branch}`
    })
    await runGit(['config', `branch.${branch}.pushRemote`, 'other-fork'])
    await expect(resolveConfiguredGitPushTarget(exec)).resolves.toEqual({
      remote: 'other-fork',
      refspec: `HEAD:${branch}`
    })
    expect(calls.filter((args) => args[0] === 'config')).toEqual([
      ['config', '--list', '-z'],
      ['config', '--list', '-z']
    ])
    for (const name of ['fork', 'other-fork']) {
      const remotePath = resolveRemotePath(name)
      await runGit(['init', '--bare', '-q', remotePath])
      await runGit(['remote', 'add', name, remotePath])
    }
    await runGit(['config', '--unset', `branch.${branch}.merge`])
    await runGit(['config', 'remote.pushDefault', 'fork'])
    const firstPush = await resolveConfiguredGitPushTarget(exec)
    expect(firstPush).toEqual({ remote: 'other-fork', refspec: 'HEAD' })
    if (!firstPush) {
      throw new Error('missing first-publish target')
    }
    await runGit(['push', '--set-upstream', firstPush.remote, firstPush.refspec])
    const head = (await runGit(['rev-parse', 'HEAD'])).stdout
    expect(
      (await runGit(['--git-dir=other-fork.git', 'rev-parse', `refs/heads/${branch}`])).stdout
    ).toBe(head)
    await expect(
      runGit(['--git-dir=fork.git', 'show-ref', '--verify', `refs/heads/${branch}`])
    ).rejects.toThrow()
  })

  it('reads SSH command and variant together with baseline-compatible NUL output', async () => {
    await runGit(['config', 'core.sshCommand', 'ssh -i "key with spaces"'])
    await runGit(['config', 'ssh.variant', 'simple'])
    const config = parseGitSshConfig((await runGit(GIT_SSH_CONFIG_ARGS)).stdout)
    expect(config).toEqual({ command: 'ssh -i "key with spaces"', variant: 'simple' })
    expect(
      buildGitSshPolicyEnv({}, config.command, config.variant).env.GIT_SSH_COMMAND
    ).toBeUndefined()
    const overridden = parseGitSshConfig(
      (await runGit(['-c', 'ssh.variant=ssh', ...GIT_SSH_CONFIG_ARGS])).stdout
    )
    expect(
      buildGitSshPolicyEnv({}, overridden.command, overridden.variant).env.GIT_SSH_COMMAND
    ).toBe('ssh -o BatchMode=yes -i "key with spaces"')
  })

  it('resolves default bases from exact refs with symbolic chains and dangling targets', async () => {
    const head = (await runGit(['rev-parse', 'HEAD'])).stdout.trim()
    await runGit(['update-ref', '-d', 'refs/remotes/origin/main'])
    await runGit(['update-ref', 'refs/remotes/origin/main/topic', head])
    await runGit(['update-ref', 'refs/remotes/origin/master', head])
    await runGit(['update-ref', 'refs/remotes/origin/release/stable', head])
    await runGit([
      'symbolic-ref',
      'refs/remotes/origin/alias',
      'refs/remotes/origin/release/stable'
    ])
    await runGit(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/alias'])
    await expect(resolveDefaultBaseRefViaExec(runGit)).resolves.toBe('origin/release/stable')
    await runGit(['update-ref', '-d', 'refs/remotes/origin/release/stable'])
    await expect(resolveDefaultBaseRefViaExec(runGit)).resolves.toBe('origin/master')
    await runGit(['update-ref', '--no-deref', 'refs/remotes/origin/HEAD', head])
    await expect(resolveDefaultBaseRefViaExec(runGit)).resolves.toBe('origin/master')
  })

  it('resolves each remote HEAD independently with Git 2.25-compatible ref output', async () => {
    const head = (await runGit(['rev-parse', 'HEAD'])).stdout.trim()
    await runGit(['update-ref', 'refs/remotes/origin/review-main', head])
    await runGit(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/review-main'])
    await runGit(['update-ref', 'refs/remotes/upstream/release/stable', head])
    await runGit([
      'symbolic-ref',
      'refs/remotes/upstream/alias',
      'refs/remotes/upstream/release/stable'
    ])
    await runGit(['symbolic-ref', 'refs/remotes/upstream/HEAD', 'refs/remotes/upstream/alias'])
    await expect(resolveRemoteHeadBranchViaExec(runGit, 'origin')).resolves.toBe('review-main')
    await expect(resolveRemoteHeadBranchViaExec(runGit, 'upstream')).resolves.toBe('release/stable')
    await expect(resolveRemoteHeadBranchViaExec(runGit, 'missing')).resolves.toBeNull()
    await runGit(['update-ref', '-d', 'refs/remotes/upstream/release/stable'])
    await expect(resolveRemoteHeadBranchViaExec(runGit, 'upstream')).resolves.toBeNull()
  })
}
