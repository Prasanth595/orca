/**
 * Scope `OOMPolicy=continue`: a kernel OOM kill of one PTY child must not stop the whole daemon
 * scope (the default `OOMPolicy=stop` SIGTERMs every sibling, daemon included).
 */

/** First systemd release that accepts `OOMPolicy=` on scope units. */
export const SYSTEMD_SCOPE_OOM_POLICY_MIN_VERSION = 253

export type DurableDaemonScopeOptions = { oomPolicyContinue?: boolean }

function leadingInteger(text: string): number | null {
  const digits = /^\s*(\d+)/.exec(text)?.[1]
  const value = digits === undefined ? null : Number(digits)
  return value !== null && Number.isSafeInteger(value) ? value : null
}

/** `systemd-run --version` prints `systemd 255 (255.4-1ubuntu8)` on its first line. */
export function parseSystemdMajorVersion(stdout: string): number | null {
  const match = /^\s*systemd\s+(\d+)/.exec(stdout.split(/\r?\n/, 1)[0] ?? '')
  return match ? leadingInteger(match[1]) : null
}

/** `systemctl --user show -p Version --value`: `259.5-0ubuntu3.4`, `257~rc1`. */
export function parseSystemdManagerVersion(value: string): number | null {
  return leadingInteger(value)
}

export function supportsScopeOomPolicy(version: number | null): boolean {
  return version !== null && version >= SYSTEMD_SCOPE_OOM_POLICY_MIN_VERSION
}

export function systemdRunOomPolicyArgs(options: DurableDaemonScopeOptions): string[] {
  return options.oomPolicyContinue ? ['--property=OOMPolicy=continue'] : []
}

export function busctlOomPolicyProperties(options: DurableDaemonScopeOptions): {
  count: number
  args: string[]
} {
  return options.oomPolicyContinue
    ? { count: 1, args: ['OOMPolicy', 's', 'continue'] }
    : { count: 0, args: [] }
}

/** Why `OOMPolicy=continue` was skipped; only meaningful when it is not applied. */
export function scopeOomPolicyReason(
  clientVersion: number | null,
  managerVersion: number | null
): string {
  if (clientVersion === null) {
    return 'OOMPolicy=continue skipped: systemd-run version unparsable'
  }
  if (!supportsScopeOomPolicy(clientVersion)) {
    return `OOMPolicy=continue skipped: systemd-run ${clientVersion} < ${SYSTEMD_SCOPE_OOM_POLICY_MIN_VERSION}`
  }
  if (managerVersion === null) {
    return 'OOMPolicy=continue skipped: user manager version unavailable'
  }
  if (!supportsScopeOomPolicy(managerVersion)) {
    return `OOMPolicy=continue skipped: user manager ${managerVersion} < ${SYSTEMD_SCOPE_OOM_POLICY_MIN_VERSION}`
  }
  return 'OOMPolicy=continue skipped: no reason recorded'
}
