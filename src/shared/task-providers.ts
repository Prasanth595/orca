export type TaskProvider = 'github' | 'gitlab' | 'linear' | 'jira' | 'plane'

export const TASK_PROVIDERS: readonly TaskProvider[] = [
  'github',
  'gitlab',
  'linear',
  'jira',
  'plane'
]

const TASK_PROVIDER_SET: ReadonlySet<unknown> = new Set<TaskProvider>(TASK_PROVIDERS)

export function isTaskProvider(value: unknown): value is TaskProvider {
  return TASK_PROVIDER_SET.has(value)
}

export const TASK_PROVIDER_LABELS: Readonly<Record<TaskProvider, string>> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  linear: 'Linear',
  jira: 'Jira',
  plane: 'Plane'
}

export type TaskProviderGlobalSettings = {
  /** Persisted last-used task source so Tasks reopens to the same provider instead of defaulting to GitHub. */
  defaultTaskSource: TaskProvider
  /** Persisted visible task providers; hides unused providers from Tasks chrome and sidebar shortcuts. */
  visibleTaskProviders: TaskProvider[]
  /** Why: one-shot guard to make Jira visible for existing profiles once, without re-adding after a later opt-out. */
  visibleTaskProvidersDefaultedForJira: boolean
  /** Why: the same one-shot guard for Plane. */
  visibleTaskProvidersDefaultedForPlane: boolean
}

// Why: these providers are scoped to a connected account on the execution host,
// not to a repository, so they keep their source across repo changes.
export const ACCOUNT_BACKED_TASK_PROVIDERS = [
  'linear',
  'jira',
  'plane'
] as const satisfies readonly TaskProvider[]
export type AccountBackedTaskProvider = (typeof ACCOUNT_BACKED_TASK_PROVIDERS)[number]
const ACCOUNT_BACKED_TASK_PROVIDER_SET: ReadonlySet<unknown> = new Set(
  ACCOUNT_BACKED_TASK_PROVIDERS
)

export function isAccountBackedTaskProvider(value: unknown): value is AccountBackedTaskProvider {
  return ACCOUNT_BACKED_TASK_PROVIDER_SET.has(value)
}

// Why: these providers key work items by a string identifier (e.g. ENG-12) and
// store number 0, so identity and labels must never fall back to the number.
export const IDENTIFIER_KEYED_PROVIDERS = [
  'linear',
  'jira',
  'plane'
] as const satisfies readonly TaskProvider[]
export type IdentifierKeyedProvider = (typeof IDENTIFIER_KEYED_PROVIDERS)[number]
const IDENTIFIER_KEYED_PROVIDER_SET: ReadonlySet<unknown> = new Set(IDENTIFIER_KEYED_PROVIDERS)

export function isIdentifierKeyedProvider(value: unknown): value is IdentifierKeyedProvider {
  return IDENTIFIER_KEYED_PROVIDER_SET.has(value)
}

export function normalizeTaskProviderSettings(value: {
  visibleTaskProviders: unknown
  defaultTaskSource: unknown
}): { visibleTaskProviders: TaskProvider[]; defaultTaskSource: TaskProvider } {
  const visibleTaskProviders = normalizeVisibleTaskProviders(value.visibleTaskProviders)
  const defaultTaskSource = isTaskProvider(value.defaultTaskSource)
    ? value.defaultTaskSource
    : resolveVisibleTaskProvider('github', visibleTaskProviders)

  if (visibleTaskProviders.includes(defaultTaskSource)) {
    return { visibleTaskProviders, defaultTaskSource }
  }

  // Why: older profiles can keep a saved default while the visible-provider
  // list drifted. Persist the default back into the list so every surface
  // reads the same settings contract.
  return {
    defaultTaskSource,
    visibleTaskProviders: TASK_PROVIDERS.filter(
      (provider) => provider === defaultTaskSource || visibleTaskProviders.includes(provider)
    )
  }
}

// Why: a provider added after profiles already saved their list is shown once on
// load; after that the one-shot flag keeps a later opt-out from being undone.
export function appendTaskProviderOnce(
  visibleProviders: readonly TaskProvider[],
  provider: TaskProvider,
  alreadyDefaulted: boolean
): TaskProvider[] {
  return alreadyDefaulted || visibleProviders.includes(provider)
    ? [...visibleProviders]
    : [...visibleProviders, provider]
}

export function normalizeVisibleTaskProviders(value: unknown): TaskProvider[] {
  if (!Array.isArray(value)) {
    return [...TASK_PROVIDERS]
  }

  const normalized: TaskProvider[] = []
  const seen = new Set<TaskProvider>()
  for (const provider of value) {
    if (isTaskProvider(provider) && !seen.has(provider)) {
      seen.add(provider)
      normalized.push(provider)
    }
  }

  // Why: at least one provider must remain visible so the Tasks surface always
  // has a valid source to select after settings hydration or manual edits.
  return normalized.length > 0 ? normalized : [...TASK_PROVIDERS]
}

export type TaskProviderAvailability = {
  gitlabInstalled: boolean
  linearConnected: boolean
}

export function filterAvailableTaskProviders(
  visibleProviders: readonly TaskProvider[],
  availability: TaskProviderAvailability
): TaskProvider[] {
  const available = visibleProviders.filter((provider) =>
    isTaskProviderAvailable(provider, availability)
  )

  return available.length > 0 ? available : ['github']
}

export function restoreAvailableDefaultTaskProvider(
  visibleProviders: readonly TaskProvider[],
  availability: TaskProviderAvailability,
  preferredProvider: unknown
): TaskProvider[] {
  const available = filterAvailableTaskProviders(visibleProviders, availability)

  // Why: older or drifted settings can hide the saved default while another
  // provider becomes available. Keep that default reachable after hydration.
  if (
    isTaskProvider(preferredProvider) &&
    isTaskProviderAvailable(preferredProvider, availability) &&
    !available.includes(preferredProvider)
  ) {
    return TASK_PROVIDERS.filter(
      (provider) => provider === preferredProvider || available.includes(provider)
    )
  }

  return available
}

function isTaskProviderAvailable(
  provider: TaskProvider,
  availability: TaskProviderAvailability
): boolean {
  switch (provider) {
    case 'github':
      return true
    case 'gitlab':
      return availability.gitlabInstalled
    // Why: Jira can be connected from the Tasks surface itself, so hiding it
    // when disconnected would remove the entry point for first-time setup.
    case 'jira':
      return true
    case 'linear':
      return availability.linearConnected
    // Why: Plane can be connected from the Tasks surface itself, so hiding it
    // when disconnected would remove the entry point for first-time setup.
    case 'plane':
      return true
  }
}

export function resolveVisibleTaskProvider(
  preferred: TaskProvider | null | undefined,
  visibleProviders: readonly TaskProvider[]
): TaskProvider {
  if (preferred && visibleProviders.includes(preferred)) {
    return preferred
  }
  return visibleProviders[0] ?? 'github'
}
