// @vitest-environment happy-dom

import { act, useMemo } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useEphemeralVmRecipeOptions } from './useEphemeralVmRecipeOptions'
import type { ReadyProjectHostSetupOption } from '@/lib/project-host-setup-options'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

type RecipeListResult = Awaited<ReturnType<typeof window.api.ephemeralVm.listRecipes>>

const roots: Root[] = []

afterEach(async () => {
  await act(async () => {
    roots.splice(0).forEach((root) => root.unmount())
  })
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

function result(ids: string[]): RecipeListResult {
  return {
    status: 'ok',
    repoPath: '/repo',
    diagnostics: [],
    recipes: ids.map((id) => ({ id, name: id, create: `create-${id}` }))
  }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function installApi(listRecipes: ReturnType<typeof vi.fn>): {
  emit: (contentPacksChanged?: boolean) => void
} {
  let listener: ((event: { contentPacksChanged: boolean }) => void) | null = null
  window.api = {
    ephemeralVm: { listRecipes },
    plugins: {
      onChanged: vi.fn((nextListener) => {
        listener = nextListener
        return () => {
          listener = null
        }
      })
    }
  } as never
  return {
    emit: (contentPacksChanged = true) => listener?.({ contentPacksChanged })
  }
}

function Harness({
  repoId,
  initialRecipeId,
  enabled = true,
  repoExecutionHostId = 'local',
  sources: providedSources
}: {
  repoId: string
  initialRecipeId?: string
  enabled?: boolean
  repoExecutionHostId?: 'local' | `runtime:${string}`
  sources?: readonly ReadyProjectHostSetupOption[]
}): React.JSX.Element {
  const sources = useMemo<readonly ReadyProjectHostSetupOption[]>(
    () =>
      providedSources ?? [
        {
          id: `${repoId}-setup`,
          kind: 'ready',
          projectId: 'project',
          hostId: repoExecutionHostId,
          repoId,
          label: repoExecutionHostId === 'local' ? 'Local Mac' : 'Central Server',
          detail: '',
          path: '/repo'
        }
      ],
    [providedSources, repoId, repoExecutionHostId]
  )
  const state = useEphemeralVmRecipeOptions({
    enabled,
    sources,
    initialRecipeId
  })
  return (
    <div>
      <span data-testid="repo">{repoId}</span>
      <span data-testid="recipes">
        {state.recipes.map((recipe) => recipe.recipeId ?? recipe.id).join(',')}
      </span>
      <span data-testid="selected">
        {state.recipes.find((recipe) => recipe.id === state.selectedRecipeId)?.recipeId ?? 'none'}
      </span>
      <span data-testid="error">{state.error ?? 'none'}</span>
    </div>
  )
}

async function render(
  element: React.ReactNode
): Promise<{ root: Root; container: HTMLDivElement }> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => root.render(element))
  return { root, container }
}

describe('useEphemeralVmRecipeOptions', () => {
  it('refetches on plugin lifecycle changes and clears only a removed selection', async () => {
    const listRecipes = vi
      .fn()
      .mockResolvedValueOnce(result(['repo', 'plugin']))
      .mockResolvedValueOnce(result(['repo', 'plugin', 'new-plugin']))
      .mockResolvedValueOnce(result(['repo']))
    const changes = installApi(listRecipes)
    const { container } = await render(<Harness repoId="repo-1" initialRecipeId="plugin" />)
    await vi.waitFor(() =>
      expect(container.querySelector('[data-testid="selected"]')?.textContent).toBe('plugin')
    )

    await act(async () => changes.emit())
    await vi.waitFor(() =>
      expect(container.querySelector('[data-testid="recipes"]')?.textContent).toContain(
        'new-plugin'
      )
    )
    expect(container.querySelector('[data-testid="selected"]')?.textContent).toBe('plugin')

    await act(async () => changes.emit())
    await vi.waitFor(() =>
      expect(container.querySelector('[data-testid="selected"]')?.textContent).toBe('none')
    )
    expect(container.querySelector('[data-testid="repo"]')?.textContent).toBe('repo-1')
  })

  it('ignores a stale recipe response after switching projects', async () => {
    const first = deferred<RecipeListResult>()
    const second = deferred<RecipeListResult>()
    installApi(vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise))
    const { root, container } = await render(<Harness repoId="repo-1" />)

    await act(async () => root.render(<Harness repoId="repo-2" />))
    await act(async () => second.resolve(result(['new-project'])))
    await act(async () => first.resolve(result(['stale-project'])))

    await vi.waitFor(() =>
      expect(container.querySelector('[data-testid="recipes"]')?.textContent).toBe('new-project')
    )
    expect(container.textContent).not.toContain('stale-project')
  })

  it('does not probe recipes while the feature is disabled', async () => {
    const listRecipes = vi.fn().mockResolvedValue(result(['hidden']))
    installApi(listRecipes)

    await render(<Harness repoId="repo-1" enabled={false} />)

    expect(listRecipes).not.toHaveBeenCalled()
  })

  it('does not send a paired-runtime repo id to local recipe discovery', async () => {
    const listRecipes = vi.fn().mockResolvedValue({
      status: 'error',
      repoPath: null,
      diagnostics: [],
      recipes: [],
      message: 'Repo not found: repo-runtime'
    })
    installApi(listRecipes)

    const { container } = await render(
      <Harness repoId="repo-runtime" repoExecutionHostId="runtime:windows-2" />
    )

    expect(listRecipes).toHaveBeenCalledWith({
      repoId: 'repo-runtime',
      ownerEnvironmentId: 'windows-2'
    })
    expect(container.querySelector('[data-testid="error"]')?.textContent).toBe(
      'Central Server: Repo not found: repo-runtime'
    )
  })
  it('discovers server recipes directly and does not guess between duplicate IDs', async () => {
    const sources: ReadyProjectHostSetupOption[] = ['local', 'runtime:central'].map(
      (_hostId, index) => ({
        id: `setup-${index}`,
        kind: 'ready',
        projectId: 'project',
        hostId: index === 0 ? 'local' : 'runtime:central',
        repoId: `repo-${index}`,
        label: index === 0 ? 'Local Mac' : 'Central Server',
        detail: '',
        path: '/repo'
      })
    )
    const listRecipes = vi.fn().mockResolvedValue(result(['worker']))
    installApi(listRecipes)
    const { container } = await render(
      <Harness repoId="repo-0" sources={sources} initialRecipeId="worker" />
    )
    await vi.waitFor(() =>
      expect(container.querySelector('[data-testid="recipes"]')?.textContent).toBe('worker,worker')
    )
    expect(listRecipes.mock.calls).toEqual([
      [{ repoId: 'repo-0' }],
      [{ repoId: 'repo-1', ownerEnvironmentId: 'central' }]
    ])
    expect(container.querySelector('[data-testid="selected"]')?.textContent).toBe('none')
  })

  it('reports an unavailable server without exposing its recipe as local', async () => {
    const sources: ReadyProjectHostSetupOption[] = [
      {
        id: 'server',
        kind: 'ready',
        projectId: 'project',
        hostId: 'runtime:central',
        repoId: 'server-repo',
        label: 'Central Server',
        detail: '',
        path: '/repo'
      }
    ]
    const listRecipes = vi.fn().mockRejectedValue(new Error('offline'))
    installApi(listRecipes)
    const { container } = await render(<Harness repoId="local-repo" sources={sources} />)
    await vi.waitFor(() =>
      expect(container.querySelector('[data-testid="error"]')?.textContent).toBe(
        'Central Server: offline'
      )
    )
    expect(listRecipes.mock.calls).toEqual([
      [{ repoId: 'server-repo', ownerEnvironmentId: 'central' }]
    ])
    expect(container.querySelector('[data-testid="recipes"]')?.textContent).toBe('')
    expect(container.querySelector('[data-testid="selected"]')?.textContent).toBe('none')
  })
})
it('never replaces a selected failed owner with a same-name local recipe', async () => {
  const sources: ReadyProjectHostSetupOption[] = [
    {
      id: 'local',
      kind: 'ready',
      projectId: 'project',
      hostId: 'local',
      repoId: 'local-repo',
      label: 'Mac',
      detail: '',
      path: '/local'
    },
    {
      id: 'central',
      kind: 'ready',
      projectId: 'project',
      hostId: 'runtime:central',
      repoId: 'server-repo',
      label: 'Central',
      detail: '',
      path: '/server'
    }
  ]
  let unavailable = false
  const listRecipes = vi.fn(async (args: { ownerEnvironmentId?: string }) => {
    if (unavailable && args.ownerEnvironmentId === 'central') {
      throw new Error('offline')
    }
    return result(['worker'])
  })
  const changes = installApi(listRecipes)
  const { container } = await render(
    <Harness
      repoId="local-repo"
      sources={sources}
      initialRecipeId={JSON.stringify(['runtime:central', 'server-repo', 'worker'])}
    />
  )
  await vi.waitFor(() =>
    expect(container.querySelector('[data-testid="selected"]')?.textContent).toBe('worker')
  )
  unavailable = true
  await act(async () => changes.emit())
  await vi.waitFor(() =>
    expect(container.querySelector('[data-testid="error"]')?.textContent).toContain(
      'Central: offline'
    )
  )
  expect(container.querySelector('[data-testid="recipes"]')?.textContent).toBe('worker')
  expect(container.querySelector('[data-testid="selected"]')?.textContent).toBe('none')
})
