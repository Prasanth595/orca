import type { CodexManagedAccount } from '../../shared/managed-account-types'
import { normalizeRuntimePathForComparison } from '../../shared/cross-platform-path'
import { parseWslUncPath } from '../../shared/wsl-paths'

/** Identify the home actually read, including legacy WSL Windows-side copies. */
export function getCodexUsageAccountId(
  accounts: CodexManagedAccount[],
  homePath: string | null
): string | undefined {
  if (!homePath) {
    return undefined
  }
  const homeKey = normalizeRuntimePathForComparison(homePath)
  const wslHome = parseWslUncPath(homePath)
  const matches = accounts.filter((account) => {
    if (normalizeRuntimePathForComparison(account.managedHomePath) === homeKey) {
      return true
    }
    return !!(
      wslHome &&
      account.managedHomeRuntime === 'wsl' &&
      account.wslDistro?.toLowerCase() === wslHome.distro.toLowerCase() &&
      account.wslLinuxHomePath &&
      normalizeRuntimePathForComparison(account.wslLinuxHomePath) ===
        normalizeRuntimePathForComparison(wslHome.linuxPath)
    )
  })
  return matches.length === 1 ? matches[0].id : undefined
}
