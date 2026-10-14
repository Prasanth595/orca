import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  ACCOUNT_BACKED_TASK_PROVIDERS,
  IDENTIFIER_KEYED_PROVIDERS,
  TASK_PROVIDER_LABELS,
  TASK_PROVIDERS,
  filterAvailableTaskProviders,
  isAccountBackedTaskProvider,
  isIdentifierKeyedProvider,
  isTaskProvider,
  normalizeTaskProviderSettings,
  normalizeVisibleTaskProviders,
  restoreAvailableDefaultTaskProvider,
  resolveVisibleTaskProvider,
  type TaskProvider,
  type TaskProviderAvailability
} from './task-providers'

const NO_AVAILABILITY: TaskProviderAvailability = { gitlabInstalled: false, linearConnected: false }
const FULL_AVAILABILITY: TaskProviderAvailability = { gitlabInstalled: true, linearConnected: true }

// Why: a Record forces every new provider to declare its availability here.
const EXPECTED_AVAILABILITY: Record<TaskProvider, { none: boolean; full: boolean }> = {
  github: { none: true, full: true },
  gitlab: { none: false, full: true },
  linear: { none: false, full: true },
  jira: { none: true, full: true }
}

const UNKNOWN_PROVIDERS: unknown[] = ['bitbucket', 'GitHub', '', null, undefined, 1, {}]

describe('task provider registry', () => {
  it.each(TASK_PROVIDERS)('%s declares explicit availability', (provider) => {
    const expected = EXPECTED_AVAILABILITY[provider]
    expect(filterAvailableTaskProviders([provider], NO_AVAILABILITY)).toEqual(
      expected.none ? [provider] : ['github']
    )
    expect(filterAvailableTaskProviders([provider], FULL_AVAILABILITY)).toEqual(
      expected.full ? [provider] : ['github']
    )
  })

  it.each(TASK_PROVIDERS)('%s round-trips through the provider guard', (provider) => {
    expect(isTaskProvider(provider)).toBe(true)
    expect(TASK_PROVIDER_LABELS[provider]).toBeTruthy()
  })

  it.each(UNKNOWN_PROVIDERS)('rejects unknown provider %j', (value) => {
    expect(isTaskProvider(value)).toBe(false)
    expect(isAccountBackedTaskProvider(value)).toBe(false)
    expect(isIdentifierKeyedProvider(value)).toBe(false)
    expect(normalizeVisibleTaskProviders([value])).toEqual([...TASK_PROVIDERS])
  })

  it('keeps provider subsets inside the provider list', () => {
    for (const provider of [...ACCOUNT_BACKED_TASK_PROVIDERS, ...IDENTIFIER_KEYED_PROVIDERS]) {
      expect(TASK_PROVIDERS).toContain(provider)
    }
    expect(TASK_PROVIDERS.filter(isAccountBackedTaskProvider)).toEqual(['linear', 'jira'])
    expect(TASK_PROVIDERS.filter(isIdentifierKeyedProvider)).toEqual(['linear', 'jira'])
  })

  it('types provider-keyed records over every provider', () => {
    expectTypeOf(TASK_PROVIDER_LABELS).toEqualTypeOf<Readonly<Record<TaskProvider, string>>>()
    expectTypeOf(EXPECTED_AVAILABILITY).toEqualTypeOf<
      Record<TaskProvider, { none: boolean; full: boolean }>
    >()
    expectTypeOf<keyof typeof TASK_PROVIDER_LABELS>().toEqualTypeOf<TaskProvider>()
  })
})

describe('task providers', () => {
  it('normalizes provider lists while preserving supported order', () => {
    expect(normalizeVisibleTaskProviders(['gitlab', 'unknown', 'gitlab', 'linear'])).toEqual([
      'gitlab',
      'linear'
    ])
  })

  it('falls back to all providers when none are visible', () => {
    expect(normalizeVisibleTaskProviders([])).toEqual(['github', 'gitlab', 'linear', 'jira'])
  })

  it('restores a valid saved default when provider settings drifted', () => {
    expect(
      normalizeTaskProviderSettings({
        visibleTaskProviders: ['linear'],
        defaultTaskSource: 'github'
      })
    ).toEqual({
      defaultTaskSource: 'github',
      visibleTaskProviders: ['github', 'linear']
    })
  })

  it('normalizes invalid saved defaults to the first visible provider', () => {
    expect(
      normalizeTaskProviderSettings({
        visibleTaskProviders: ['gitlab'],
        defaultTaskSource: 'bitbucket'
      })
    ).toEqual({
      defaultTaskSource: 'gitlab',
      visibleTaskProviders: ['gitlab']
    })
  })

  it('resolves hidden preferred providers to the first visible provider', () => {
    expect(resolveVisibleTaskProvider('github', ['linear'])).toBe('linear')
  })

  it('filters runtime-unavailable providers without changing preference normalization', () => {
    expect(
      filterAvailableTaskProviders(['github', 'gitlab', 'linear'], {
        gitlabInstalled: false,
        linearConnected: true
      })
    ).toEqual(['github', 'linear'])
  })

  it('keeps an available saved default visible when provider visibility drifted', () => {
    expect(
      restoreAvailableDefaultTaskProvider(
        ['linear'],
        {
          gitlabInstalled: false,
          linearConnected: true
        },
        'github'
      )
    ).toEqual(['github', 'linear'])
  })

  it('preserves intentionally narrowed providers when the saved default matches them', () => {
    expect(
      restoreAvailableDefaultTaskProvider(
        ['linear'],
        {
          gitlabInstalled: false,
          linearConnected: true
        },
        'linear'
      )
    ).toEqual(['linear'])
  })

  it('does not restore an unavailable saved default', () => {
    expect(
      restoreAvailableDefaultTaskProvider(
        ['linear'],
        {
          gitlabInstalled: false,
          linearConnected: true
        },
        'gitlab'
      )
    ).toEqual(['linear'])
  })

  it('ignores invalid saved defaults while restoring visible providers', () => {
    expect(
      restoreAvailableDefaultTaskProvider(
        ['gitlab'],
        {
          gitlabInstalled: false,
          linearConnected: true
        },
        'bitbucket'
      )
    ).toEqual(['github'])
  })

  it('falls back to GitHub when every preferred provider is unavailable', () => {
    expect(
      filterAvailableTaskProviders(['gitlab', 'linear'], {
        gitlabInstalled: false,
        linearConnected: false
      })
    ).toEqual(['github'])
  })
})
