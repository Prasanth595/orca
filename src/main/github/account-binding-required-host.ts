import { isUnresolvedSshHostAlias, foldComparableGitHubHost } from '../../shared/git-remote-host-alias'
import {
  githubHostFromIdentityKey,
  isDefaultGitHubHost
} from '../../shared/github/repository-identity-key'
import { resolveUserSshConfigHost } from '../ssh/ssh-config-host-picker'

export type SshAliasHostnameResolver = (alias: string) => Promise<{ hostname: string } | null>

/**
 * Host filter for Settings GitHub account binding.
 * `undefined` means do not filter, which is how a github.com remote already behaves.
 */
export async function resolveGhAccountRequiredHost(
  canonicalKey: string | null | undefined,
  resolveAlias: SshAliasHostnameResolver = resolveUserSshConfigHost
): Promise<string | undefined> {
  const host = githubHostFromIdentityKey(canonicalKey)
  if (!host || !isUnresolvedSshHostAlias(host)) {
    return host
  }
  // Why: `git@github-personal:owner/repo` keeps the OpenSSH alias in the identity key.
  // No gh login is named after that alias, so filtering to it empties the dropdown.
  const resolved = await resolveAlias(host).catch(() => null)
  const hostname = resolved?.hostname?.trim()
  if (!hostname || isUnresolvedSshHostAlias(hostname)) {
    return undefined
  }
  const folded = foldComparableGitHubHost(hostname)
  return isDefaultGitHubHost(folded) ? undefined : folded
}
