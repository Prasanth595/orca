// The account a local terminal agent runs on, published by the execution host on its status row.

export type AgentRunAccountProvider = 'claude' | 'codex'

/** 'kept' = a person kept this agent on its account; 'follow' = it moves with the selection. */
export type AgentRunAccountMode = 'follow' | 'kept'

export type AgentRunAccount = {
  provider: AgentRunAccountProvider
  /** Selection lane key ('host' | 'wsl:<distro>'). */
  lane: string
  /** Managed account id; null = System default. */
  accountId: string | null
  mode: AgentRunAccountMode
  /** Claude only: which pointer a `claude` typed in this terminal reads. */
  shellRoute?: 'selected' | 'account'
  /** Why Keep cannot be offered for this agent right now. */
  keepUnavailable?: 'no-session' | 'codex-home-not-keepable'
}

const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export function isAgentRunAccountId(value: unknown): value is string {
  return typeof value === 'string' && ACCOUNT_ID_PATTERN.test(value)
}

function isLaneKey(value: unknown): value is string {
  return value === 'host' || (typeof value === 'string' && /^wsl:.{1,256}$/.test(value))
}

/** Strict reader for persisted or received facets: anything unexpected is no facet. */
export function readAgentRunAccount(value: unknown): AgentRunAccount | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const provider = 'provider' in value ? value.provider : undefined
  const lane = 'lane' in value ? value.lane : undefined
  const accountId = 'accountId' in value ? value.accountId : undefined
  const mode = 'mode' in value ? value.mode : undefined
  const shellRoute = 'shellRoute' in value ? value.shellRoute : undefined
  const keepUnavailable = 'keepUnavailable' in value ? value.keepUnavailable : undefined
  if (
    (provider !== 'claude' && provider !== 'codex') ||
    !isLaneKey(lane) ||
    (accountId !== null && !isAgentRunAccountId(accountId)) ||
    (mode !== 'follow' && mode !== 'kept') ||
    (shellRoute !== undefined && shellRoute !== 'selected' && shellRoute !== 'account') ||
    (shellRoute !== undefined && provider !== 'claude') ||
    (keepUnavailable !== undefined &&
      keepUnavailable !== 'no-session' &&
      keepUnavailable !== 'codex-home-not-keepable')
  ) {
    return undefined
  }
  return {
    provider,
    lane,
    accountId,
    mode,
    ...(shellRoute !== undefined ? { shellRoute } : {}),
    ...(keepUnavailable !== undefined ? { keepUnavailable } : {})
  }
}

export function agentRunAccountsEqual(
  left: AgentRunAccount | null | undefined,
  right: AgentRunAccount | null | undefined
): boolean {
  if (!left || !right) {
    return !left && !right
  }
  return (
    left.provider === right.provider &&
    left.lane === right.lane &&
    left.accountId === right.accountId &&
    left.mode === right.mode &&
    left.shellRoute === right.shellRoute &&
    left.keepUnavailable === right.keepUnavailable
  )
}
