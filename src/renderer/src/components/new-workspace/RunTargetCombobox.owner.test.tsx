// @vitest-environment happy-dom
import React, { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import type { ReadyProjectHostSetupOption } from '@/lib/project-host-setup-options'
import RunTargetCombobox from './RunTargetCombobox'
import { useEphemeralVmRecipeOptions } from '@/hooks/useEphemeralVmRecipeOptions'
import { buildEphemeralVmRecipeRequest } from '@/lib/ephemeral-vm-recipe-option'

vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverAnchor: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}))

it('selects the recipe owner directly while the Mac host is selected', async () => {
  const local: ReadyProjectHostSetupOption = {
    id: 'local-setup',
    kind: 'ready',
    projectId: 'project',
    hostId: 'local',
    repoId: 'local-repo',
    label: 'Local Mac',
    detail: '',
    path: '/local/project'
  }
  const central: ReadyProjectHostSetupOption = {
    ...local,
    id: 'central-setup',
    hostId: 'runtime:central',
    repoId: 'central-repo',
    label: 'Central Server',
    path: '/server/project'
  }
  const choice = {
    id: 'central-choice',
    recipeId: 'worker',
    name: 'Worker VM',
    create: './create',
    source: central,
    ownerEnvironmentId: 'central'
  }
  const calls: string[] = []
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  try {
    await act(async () =>
      root.render(
        <RunTargetCombobox
          hostOptions={[local, central]}
          hostValue={local.id}
          recipes={[choice]}
          recipeValue={null}
          onHostChange={(id) => calls.push(`host:${id}`)}
          onRecipeChange={(id) => calls.push(`recipe:${id}`)}
        />
      )
    )
    const row = [...container.querySelectorAll<HTMLElement>('[role="option"]')].find((node) =>
      node.textContent?.includes('Worker VM')
    )
    expect(row).toBeDefined()
    expect(row?.textContent).toContain('Central Server')
    await act(async () => row?.click())
    expect(calls).toEqual(['host:central-setup', 'recipe:central-choice'])
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})

it('discovers, selects and submits a server recipe in one action from a local project', async () => {
  const sources: ReadyProjectHostSetupOption[] = [
    {
      id: 'mac',
      kind: 'ready',
      projectId: 'project',
      hostId: 'local',
      repoId: 'mac-repo',
      label: 'Local Mac',
      detail: '',
      path: '/local'
    },
    {
      id: 'server',
      kind: 'ready',
      projectId: 'project',
      hostId: 'runtime:central',
      repoId: 'server-repo',
      label: 'Central Server',
      detail: '',
      path: '/server'
    }
  ]
  const previousApi = window.api
  const listRecipes = vi.fn().mockResolvedValue({
    status: 'ok',
    repoPath: '/repo',
    diagnostics: [],
    recipes: [
      { id: 'worker', name: 'Worker VM', create: './create', checkoutMode: 'provisioned-root' }
    ]
  })
  Object.assign(window, { api: { ephemeralVm: { listRecipes } } })
  const provision = vi.fn()
  function ComposerProbe(): React.JSX.Element {
    const [host, setHost] = useState(sources[0])
    const state = useEphemeralVmRecipeOptions({ enabled: true, sources })
    return (
      <>
        <RunTargetCombobox
          hostOptions={sources}
          hostValue={host.id}
          recipes={state.recipes}
          recipeValue={state.selectedRecipeId}
          onHostChange={(id) => setHost(sources.find((source) => source.id === id) ?? sources[0])}
          onRecipeChange={state.setSelectedRecipeId}
        />
        <button
          type="button"
          data-create
          onClick={() =>
            provision(
              buildEphemeralVmRecipeRequest(
                state.selectedRecipeId ?? '',
                state.recipes,
                host.repoId,
                host.projectId,
                host.hostId
              )
            )
          }
        >
          Create
        </button>
      </>
    )
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(<ComposerProbe />))
    await vi.waitFor(() => expect(listRecipes).toHaveBeenCalledTimes(2))
    const row = [...container.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (node) =>
        node.textContent?.includes('Worker VM') && node.textContent.includes('Central Server')
    )
    expect(row).toBeDefined()
    await act(async () => row?.click())
    expect(container.querySelector('[data-run-target-combobox-root]')?.textContent).toContain(
      'Central Server'
    )
    await act(async () => container.querySelector<HTMLButtonElement>('[data-create]')?.click())
    expect(provision).toHaveBeenCalledWith({
      ownerEnvironmentId: 'central',
      sourceRepoId: 'server-repo',
      recipeId: 'worker',
      projectId: 'project',
      checkoutMode: 'provisioned-root'
    })
    expect(listRecipes).toHaveBeenCalledWith({
      repoId: 'server-repo',
      ownerEnvironmentId: 'central'
    })
  } finally {
    await act(async () => root.unmount())
    container.remove()
    Object.assign(window, { api: previousApi })
  }
})
